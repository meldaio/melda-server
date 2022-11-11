const EventEmitter = require("events")
const Jupyter = require("@jupyterlab/services")
const AWS = require('aws-sdk')
const configuration = require("./configuration")
const { parseArn, buildArn } = require("../../utils")
const axios = require("axios")
const DeploymentError = require("../error")
const efs = require("./efs")

/**
 * AWS CONFIGURATION
 */
const { AWS_REGION, AWS_LAUNCH_TYPE, AWS_EFS_ENABLED } = process.env
const ECS = new AWS.ECS({ region: AWS_REGION })
const EC2 = new AWS.EC2({ region: AWS_REGION })

/**
 * JUPYTER CONFIGURATION
 */
const { JUPYTER_TOKEN,
  JUPYTER_HTTP_PROTOCOL,
  JUPYTER_HOST,
  JUPYTER_PORT,
  JUPYTER_WS_PROTOCOL,
  JUPYTER_HELPER_HOST,
  JUPYTER_HELPER_PORT,
  JUPYTER_HELPER_HTTP_PROTOCOL } = process.env

const serverSettings = Jupyter.ServerConnection.makeSettings({
  token: JUPYTER_TOKEN,
  baseUrl: JUPYTER_HTTP_PROTOCOL +"://"+ JUPYTER_HOST +":"+ JUPYTER_PORT +"/",
  wsUrl: JUPYTER_WS_PROTOCOL +"://"+ JUPYTER_HOST +":"+ JUPYTER_PORT +"/",
})

const JUPYTER_HELPER_SERVER = JUPYTER_HELPER_HTTP_PROTOCOL
  + "://" + JUPYTER_HELPER_HOST + ":" + (JUPYTER_HELPER_PORT || "80") + "/"

/**
 * INTERNAL CONFIGURATION
 */
const BEGINNING_PORT = 5000
const PORTS_TO_PUBLISH = [ 5000, 5001, 5002, 5003, 5004, 5005 ]
const KERNEL_STATUS_CHECK_INTERVAL = 2000
const PORT_NAMES = [
  "shell_port", // 5000
  "iopub_port", // 5001
  "stdin_port", // 5002
  "control_port", // 5003
  "hb_port", // 5004
]
/*
const KERNEL_TASK_DEFINITONS = {
  ir: AWS_LAUNCH_TYPE === "EC2" ? "melda-irkernel:3" : "melda-irkernel:2",
  python3: AWS_LAUNCH_TYPE === "EC2" ? "melda-ipython:2" : "melda-ipython:1"
}
*/

// Cache:
var portsInUse;

class KernelTask {

  static findAvailablePorts(total) {
    var prom = Promise.resolve()
    var found = []
    var port = BEGINNING_PORT - 1

    if (total === undefined) {
      total = PORTS_TO_PUBLISH.length
    }

    if ( ! portsInUse ) {
      prom = this.getAllTasks()
        .then(tasks => {
          portsInUse = []

          tasks.forEach(task => {
            task.containers.forEach(container => {
              container.networkBindings.forEach(binding => {
                portsInUse.push(binding.hostPort)
              })
            })
          })
        })
    }

    return prom.then(() => {
      while (port++ < 65000) {
        if (portsInUse.includes(port)) {
          continue
        }

        found.push(port)

        if (found.length >= total) {
          return found
        }
      }

      throw new DeploymentError("Couldn't find any available port")
    })
  }

  static getAllTasks() {
    return configuration
      .promise()
      .then(({ cluster }) => {
        return ECS
          .listTasks({ cluster })
          .promise()
          .then(({ taskArns }) => {
            if ( ! taskArns.length ) {
              return { tasks: [] }
            }

            return ECS
              .describeTasks({ cluster, tasks: taskArns })
              .promise()
          })
      })
      .then(({ tasks }) => tasks)
  }

  constructor(name, user) {
    /**
     * Kernel name. "ir" or "python3".
     * @type {String}
     */
    this.name = name
    /**
     * User info.
     * @type {Object}
     */
    this.user = user
    /**
     * AWS task object
     * @type {Object}
     */
    this.task = null
    /**
     * UUID string
     * @type {String}
     */
    this.id = null
    /**
     * Task ip
     * @type {String}
     */
    this.ip = null
    /**
     * AWS ARN string
     * @type {String}
     */
    this.arn = null
    /**
     * Connection configuration required by Jupyter
     * @type {Object}
     */
    this.config = null
    /**
     * Task definition name in format
     *   family:revision
     * @type {String}
     */
    this.definition = null
    /**
     * Exposed ports of the container
     * @type {Array}
     */
    this.ports = []
    /**
     * EFS URL to pass container.
     * @type {String}
     */
    this.fs = null
    /**
     * Jupyter's kernel object.
     * @type {Object}
     */
    this.jupyterKernel = null
    /**
     * Kernel status. This isn't same with the task status.
     * Possible values are (in the given order):
     *   INIT
     *   CREATINGTASK
     *   TASKCREATED
     *   TASKREADY
     *   GETTINGIP
     *   GOTIP
     *   CREATINGCONFIG
     *   CONFIGREADY
     *   CONNECTINGJUPYTER
     *   JUPYTERCONNECTED
     *   GETTINGFS
     *   GOTFS
     *   CREATINGFS
     *   FSCREATED
     *   READY
     *   SHUTTINGDOWN
     *   DEAD
     *   ERROR
     * @type {String}
     */
    this.status = "CREATINGTASK"
    /**
     * Status name indexed event callbacks.
     * @type {Object}
     */
    this.callbacks = {}
    /**
     * @type {Array}
     */
    this.errorCallbacks = []
    /**
     * @type {Mixed}
     */
    this.lastError = null
    /**
     * Event history for monitoring.
     * @type {Array}
     */
    this.eventHistory = []
    /**
     * @type {Array}
     */
    this.historyCallbacks = []
  }

  init() {
    this.event("INIT")

    return this.registerDefinition()
      .then(() => this.setFileSystem())
      .then(() => this.createTask())
      .then(() => this.deregisterDefinition())
      .then(() => this.setIp())
      .then(() => this.setJupyterConfiguration())
      .then(() => this.connectToJupyter())
      .then(() => this.ready())
      .catch(err => this.error(err))
  }
  /**
   * Shurtcut for .event("READY", cb)
   * @param  {Function}   cb Callback function
   * @return {KernelTask}      this
   */
  ready(cb) { return this.event("READY", cb) }
  /**
   * Shurtcut for .event("DEAD", cb)
   * @param  {Function}   cb Callback function
   * @return {KernelTask}      this
   */
  dead(cb) { return this.event("DEAD", cb) }
  /**
   * Triggers and registers events. Triggers given event if callback is omitted.
   * @param  {String}     status   PENDING, IP, READY, SHUTTINGDOWN, DEAD
   * @param  {Function}   callback Callback function
   * @return {KernelTask}          this
   */
  event(status, callback) {
    var cb

    if ( ! this.callbacks[ status ] ) {
      this.callbacks[ status ] = []
    }

    if ( ! callback ) {
      this.status = status
      this.history(status)
    } else {
      this.callbacks[status].push(callback)
    }

    if (status === this.status) {
      while (cb = this.callbacks[status].shift())
        cb()
    }

    return this
  }
  /**
   * Triggers error event or registers a callback function to error event.
   * @param  {Function}   callback Callback function
   * @return {KernelTask}          this
   */
  error(callback) {
    var err = callback
    var errorString = "Unknown error"

    if (typeof callback === "function") {
      this.errorCallbacks.push(callback)
    } else {
      this.status = "ERROR"
      this.lastError = err

      try {
        errorString = err.toString()
      } catch(e) {}

      this.history("ERROR", errorString)
    }

    if (this.status === "ERROR") {
      this.errorCallbacks.forEach(cb => cb(this.lastError))
    }

    return this
  }
  /**
   * Adds an entry to history or registers a callback for history changes.
   * @param  {Mixed}      event Event name or history callback
   * @param  {Object}     data  Event data
   * @return {KernelTask}       this
   */
  history(event, data = null) {
    var callback = typeof event === "function" ? event : null
    var date = new Date()

    if ( ! callback ) {
      this.eventHistory.push({ event, data, date })
      this.historyCallbacks.forEach(cb => cb(this.eventHistory))
    } else {
      this.historyCallbacks.push(callback)
    }

    return this
  }
  /**
   * Exports information about this kernel.
   * @return {Object}
   */
  info() {
    return {
      name: this.name,
      id: this.id,
      status: this.status,
      history: this.eventHistory,
    }
  }
  /**
   * Creates a task on AWS cluster and returns a promise resolved with it.
   * @return {Promise} Resolved with task object
   */
  createTask() {
    this.event("CREATINGTASK")

    var prom = Promise.resolve()

    return configuration
      .promise()
      .then(({ cluster, network }) => {
        var config = {
          cluster,
          taskDefinition: this.definition,
          launchType: AWS_LAUNCH_TYPE,
        }

        if (AWS_LAUNCH_TYPE === "FARGATE") {
          config.networkConfiguration = network
        }

        if (AWS_LAUNCH_TYPE === "EC2" && this.fs) {
          config.overrides = {
            containerOverrides: [{
              name: this.getContainerName(),
              environment: [{
                name: "EFS_ID",
                value: this.fs
              }, {
                name: "PROJECT_FOLDER",
                value: this.user
              }, {
                name: "BUCKET_NAME",
                value: process.env.AWS_S3_BUCKET_NAME
              }]
            }]
          }
        }else {
          config.overrides = {
            containerOverrides: [{
              name: this.getContainerName(),
              environment: [{
                name: "PROJECT_FOLDER",
                value: this.user
              }, {
                name: "BUCKET_NAME",
                value: process.env.AWS_S3_BUCKET_NAME
              }]
            }]
          }
        }

        return ECS.runTask(config).promise()
      })
      .then(({ tasks, failures }) => {
        var errorMessage

        if ( ! tasks || tasks.length < 1 ) {
          try {
            errorMessage = "Task couldn't be created. Reason: "
              + failures[0].reason
          } catch (err) {
            errorMessage = "Task couldn't be created. Reason: Unknown"
          }

          throw new DeploymentError(errorMessage)
        }

        this.task = tasks[0]
        this.arn = this.task.taskArn
        // Tasks names are uuids, so we can use task name as kernel id
        this.id = parseArn(this.arn).name

        this.event("TASKCREATED")

        return this.waitForStatus()
      })
      .then(() => {
        this.event("TASKREADY")
        return this.task
      })
  }

  getContainerName() {
    var definition = require("./task-definitions/"+ this.name +".json")
    return definition.containerDefinitions[0].name
  }

  getDefinition() {
    var definition = require("./task-definitions/"+ this.name +".json")

    return this.constructor
      .findAvailablePorts()
      .then(ports => {
        var i = 0

        definition.containerDefinitions[0].portMappings = ports.map(port => {
          return {
            containerPort: PORTS_TO_PUBLISH[i++],
            hostPort: port,
            protocol: "tcp"
          }
        })

        portsInUse = portsInUse.concat(ports)
        this.ports = ports

        return definition
      })
  }

  registerDefinition() {
    this.event("REGISTERINGDEFINITION")
    return this
      .getDefinition()
      .then(
        definition => ECS
          .registerTaskDefinition(definition)
          .promise()
      )
      .then(({ taskDefinition }) => {
        this.definition = taskDefinition.family + ":" + taskDefinition.revision
        this.event("DEFINITIONREGISTERED")
        return this.definition
      })
  }

  deregisterDefinition() {
    this.event("REMOVINGDEFINITION")
    return ECS
      .deregisterTaskDefinition({ taskDefinition: this.definition })
      .promise()
      .then(() => this.event("DEFINITIONREMOVED"))
  }

  setFileSystem() {
    if (AWS_EFS_ENABLED !== "1") {
      return Promise.resolve()
    }

    this.event("GETTINGFS")

    return efs
      //.get(this.user.email + "-" + this.user._id)
      .get(this.user.email)
      .then(({ fsId, creation }) => {
        if (fsId) {
          this.event("GOTFS")
          return this.fs = fsId
        } else {
          this.event("CREATINGFS")

          return creation
            .then(fsId => {
              this.event("FSCREATED")
              this.event("GOTFS")
              this.fs = fsId
            })
        }
      })
  }
  /**
   * Sets ip of this kernel. 
   * @return {Promise} Resolved with ip.
   */
  setIp() {
    this.event("GETTINGIP")

    return this[ AWS_LAUNCH_TYPE + "Ip" ]
      .call(this)
      .then(ip => {
        this.ip = ip
        this.event("GOTIP")

        return this.ip
      })
  }
  /**
   * For EC2 launch type returns a promise resolved with instance's ip.
   * @return {Promise}
   */
  EC2Ip() {
    var containerInstances = [this.task.containerInstanceArn]

    return configuration
      .promise()
      .then(
        ({ cluster }) => ECS
          .describeContainerInstances({ cluster, containerInstances })
          .promise()
      )
      .then(({ containerInstances }) => {
        var InstanceIds

        try {
          InstanceIds = [containerInstances[0].ec2InstanceId]
        } catch(e) {}

        if ( ! InstanceIds ) {
          throw new DeploymentError("Couldn't retrieve instance id")
        }

        return EC2
          .describeInstances({ InstanceIds })
          .promise()
      })
      .then(({ Reservations }) => {
        var ip

        try {
          ip = Reservations[0].Instances[0].PublicIpAddress
        } catch(e) {}

        if ( ! ip ) {
          throw new DeploymentError("Couldn't retrieve ip of instance")
        }

        return ip
      })
  }
  /**
   * For FARGATE launch type returns a promise resolved with instance's ip.
   * @return {Promise}
   */
  FARGATEIp() {
    var eniId

    try {
      this.task.attachments.forEach(attc => {
        if (attc.type === "ElasticNetworkInterface") {
          attc.details.forEach(obj => {
            if (obj.name === "networkInterfaceId") {
              eniId = obj.value
            }
          })
        }
      })
    } catch(e) {}

    if ( ! eniId ) {
      throw new DeploymentError("Network interface id couldn't be found")
    }

    return EC2
      .describeNetworkInterfaces({ NetworkInterfaceIds: [eniId] })
      .promise()
      .then(({ NetworkInterfaces }) => {
        if ( ! NetworkInterfaces || NetworkInterfaces.length < 1 ) {
          throw new DeploymentError("Network interface couldn't be found")
        }

        var ip

        try { ip = NetworkInterfaces[0].Association.PublicIp }
        catch(e) {}

        if ( ! ip ) {
          throw new DeploymentError("Couldn't retrieve ip of kernel task")
        }

        return ip
      })
  }
  /**
   * Creates the kernel configuration json in jupyter's runtime directory.
   * Returns a promise resolved with an object contains id and the
   * configuration.
   * @param  {String}  id Kernel id
   * @return {Promise}    Resolved with Jupyter kernel configuration
   */
  setJupyterConfiguration() {
    this.event("CREATINGCONFIG")

    var params = {
      id: this.id,
      ip: this.ip,
      kernel_name: this.name,
    }

    if (this.ports.length) {
      PORT_NAMES.forEach((name, i) => {
        params[ name ] = this.ports[i]
      })
    }

    return axios
      .get(JUPYTER_HELPER_SERVER + "create-kernel-config", { params })
      .then(response => {
        this.config = response.data
        this.event("CONFIGREADY")
        return this.config
      })
  }
  /**
   * Sets jupyterKernel.
   * @return {Promise} Resolved with jupyterKernel object
   */
  connectToJupyter() {
    var name = this.name + "-" + this.id
    this.event("CONNECTINGJUPYTER")

    return Jupyter.Kernel
      .startNew({ name, serverSettings })
      .then(jupyterKernel => {
        this.jupyterKernel = jupyterKernel
        this.event("JUPYTERCONNECTED")
        return this.jupyterKernel
      })
  }
  /**
   * Shutdowns task and jupyterKernel.
   * @return {Promise}
   */
  kill() {
    if (this.status === "DEAD") {
      return Promise.resolve()
    }

    // If shutting down already started:
    if (this.status === "SHUTTINGDOWN") {
      return new Promise((res, rej) => {
        this.dead(() => res())
      })
    }

    return new Promise((res, rej) => {
      // Wait for kernel to get ready
      this.ready(() => {
        var prom = Promise.resolve()

        // Kill function may be called multiple times before kernel gets ready.
        if (this.status === "SHUTTINGDOWN") {
          return this.dead(() => res())
        }

        this.event("SHUTTINGDOWN")

        if (this.jupyterKernel) {
          prom = this.jupyterKernel.shutdown()
        }

        prom
          .then(() => configuration.promise())
          .then(
            ({ cluster }) => ECS
              .stopTask({ task: this.arn, cluster})
              .promise()
          )
          .then(() => this.waitForStatus())
          .then(() => {
            this.event("DEAD")
            res()
          })
          .catch(err => {
            rej(err)
            this.error(err)
          })
      })

    })
  }
  /**
   * Updates AWS task object.
   * @return {Promise} Resolved with task object.
   */
  updateTask() {
    return configuration
      .promise()
      .then(({ cluster }) => {
        return ECS
          .describeTasks({ cluster, tasks: [this.id] })
          .promise()
      })
      .then(({ tasks, failures }) => {
        var errorMessage

        if ( ! tasks || tasks.length < 1 ) {
          try {
            errorMessage = "Task couldn't be found. Reason: "
              + failures[0].reason
          } catch (err) {
            errorMessage = "Task couldn't be found. Reason: Unknown"
          }

          throw new DeploymentError(errorMessage)
        }

        // Update task object also
        return this.task = tasks[0]
      })
  }

  installPackage(name) {
    return axios
      .get("http://" + this.ip + ":" + this.ports[5] + "/install/" + encodeURIComponent(name))
      .then(response => {
        if (typeof response.data !== "object") {
          try {
            response.data = JSON.parse(response.data)
          } catch(err) {
            response.data = { success: false, message: "Unexpected response from kernel", result: [] }
          }
        }

        if ( ! response.data.success ) {
          if (response.data.message) {
            throw new DeploymentError(response.data.message)
          } else {
            throw new DeploymentError("Unknown error")
          }
        }

        if ( ! response.data.result ) {
          response.data.result = [name]
        }

        return Promise.resolve(response.data.result)
      })
  }

  removePackage(name) {
    return axios
      .get("http://" + this.ip + ":" + this.ports[5] + "/remove/" + encodeURIComponent(name))
      .then(response => {
        if (typeof response.data !== "object") {
          try {
            response.data = JSON.parse(response.data)
          } catch(err) {
            response.data = { success: false, message: "Unexpected response from kernel", result: [] }
          }
        }

        if ( ! response.data.success ) {
          if (response.data.message) {
            throw new DeploymentError(response.data.message)
          } else {
            throw new DeploymentError("Unknown error")
          }
        }

        return Promise.resolve(name)
      })
  }
  /**
   * Returns a promise resolved when kernel's status is equal to desired
   * status.
   * @param  {String} taskStatus Desired status. Leave empty to wait for
   *                             kernel object's own desired status.
   * @return {Promise}
   */
  async waitForStatus(taskStatus) {
    return this
      .updateTask()
      .then(task => {
        if (taskStatus === undefined) {
          taskStatus = task.desiredStatus
        }

        if (task.lastStatus === taskStatus) {
          return Promise.resolve(task)
        }

        return new Promise((res, rej) => {
          setTimeout(
            () => this.waitForStatus().then(res).catch(rej),
            KERNEL_STATUS_CHECK_INTERVAL
          )
        })
      })
  }

}

module.exports = KernelTask


function test() {


  return;

  KernelTask.findAvailablePorts()
    .then(ports => {
      console.log(ports)
    })



  return;
  ECS.registerTaskDefinition(require("./task-definitions/ir.json"))
  .promise()
  .then(({taskDefinition}) => {
  })
  .catch(err => console.error("failed", err))






  return;
  return configuration
    .promise()
    .then(({ cluster, network }) => {
      var prom = Promise.resolve(false)

      if (AWS_LAUNCH_TYPE === "EC2") {
        prom = KernelTask.findAvailablePorts(PORTS_TO_PUBLISH.length)
      }

      return prom.then(ports => {
        var networkBindings
        var i = 0
        var config = {
          cluster,
          taskDefinition: KERNEL_TASK_DEFINITONS[ this.name ],
          launchType: AWS_LAUNCH_TYPE,
        }

        // If launch type is EC2
        if (ports) {
          networkBindings = ports.map(port => {
            return {
              bindIp: "0.0.0.0",
              containerPort: PORTS_TO_PUBLISH[i++],
              hostPort: port[i++],
              protocol: "tcp"
            }
          })

          config.overrides = {
            containerOverrides: [{ networkBindings }]
          }
        }
        
        if (AWS_LAUNCH_TYPE === "FARGATE") {
          config.networkConfiguration = network
        }

        return ECS.runTask(config).promise()
      })
    })
    .then(({ tasks, failures }) => {
      var errorMessage

      if ( ! tasks || tasks.length < 1 ) {
        try {
          errorMessage = "Task couldn't be created. Reason: "
            + failures[0].reason
        } catch (err) {
          errorMessage = "Task couldn't be created. Reason: Unknown"
        }

        throw new DeploymentError(errorMessage)
      }

      this.task = tasks[0]
      this.arn = this.task.taskArn
      // Tasks names are uuids, so we can use task name as kernel id
      this.id = parseArn(this.arn).name

      this.event("TASKCREATED")

      return this.waitForStatus()
    })
    .then(() => {
      this.event("TASKREADY")
      return this.task
    })
}

// test()
