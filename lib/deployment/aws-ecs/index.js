const Deployment = require("../interface.js")
const DeploymentError = require("../error.js")
const KernelTask = require("./kernel-task")
const reserveConfig = require("./reserve-config")
const configuration = require("./configuration")
const monitor = require("../../monitor")

var kernels = []

var reserves = { ir: [], python3: [] }

class AWSECS extends Deployment {
  /**
   * Creates an instance of KernelTask. Stores it in global "kernels" variable.
   * @param  {String}     name Kernel name
   * @return {KernelTask}
   */
  static create(name) {
    var kernel = new KernelTask(name)

    kernels.push(kernel)
    kernel.history(() => monitor.send("update-kernels", this.status()))
    kernel.init()

    return kernel
  }
  /**
   * Allocates a kernel for given user. Uses reserved kernel if there are any.
   * @param  {String}     name Kernel name
   * @param  {Object}     user User object
   * @return {KernelTask}
   */
  static allocate(name, user, context) {
    var kernel = reserves[name] && reserves[name].length > 0
      ? reserves[name].shift()
      : this.create(name, user)

    kernel.context = context
    kernel.user = user

    monitor.send("update-kernels", this.status())
    this.setupReserves()

    return kernel
  }
  /**
   * Cleans dead kernels.
   * @return {Void}
   */
  static flush() {
    kernels = kernels.filter(kernel => kernel.status !== "DEAD")

    for (var name in reserves) {
      reserves[name] = reserves[name]
        .filter(kernel => kernel.status !== "DEAD")
    }

    monitor.send("update-kernels", this.status())
    this.setupReserves()
  }
  /**
   * Returns all running kernels for monitoring purposes.
   * @return {Object}
   */
  static status() {
    return kernels.map(kernel => {
      var obj = kernel.info()

      obj.context = kernel.context

      if (kernel.user) {
        obj.user = {
          name: kernel.user.name,
          email: kernel.user.email,
          id: kernel.user.id
        }
      }

      return obj
    })
  }
  /**
   * Kills a kernel
   * @param  {String}  id Kernel id
   * @return {Promise}    Will be resolved when it is killed
   */
  static kill(id) {
    var kernel = kernels.find(kernel => kernel.id === id)
    return kernel.kill()
  }

  static setupReserves() {
    if (process.env.AWS_LAUNCH_TYPE !== "FARGATE") {
      return;
    }

    var assigned = kernels.filter(kernel => !!kernel.user).length
    var available = reserveConfig.maxKernel - assigned
    var { irkernelReserve, ipythonReserve } = reserveConfig
    var totalReserve = irkernelReserve + ipythonReserve

    var irkernelReserve = Math.min(
      Math.round(irkernelReserve * available / totalReserve),
      irkernelReserve
    )
    var ipythonReserve = Math.min(
      Math.round(ipythonReserve * available / totalReserve),
      ipythonReserve
    )

    irkernelReserve -= reserves.ir.length
    ipythonReserve -= reserves.python3.length

    if (irkernelReserve > 0) {
      while (irkernelReserve--) {
        reserves.ir.push(this.create("ir"))
      }
    }
    if (ipythonReserve > 0) {
      while (ipythonReserve--) {
        reserves.python3.push(this.create("python3"))
      }
    }
  }


  constructor(...args) {
    super(...args)
  }

  init() {
    return configuration.promise().then(config => this)
  }

  startKernel(name, context) {
    return this.init()
      .then(() => this.constructor.allocate(name, this.user, context))
      .then(kernel => {
        return new Promise((res, rej) => {
          kernel.ready(() => res(kernel.jupyterKernel))
          kernel.error(error => rej(error))
        })
      })
  }

  shutdownKernel(jupyterKernel) {
    var kernel = this.findKernelTask(jupyterKernel)

    return kernel ? kernel.kill() : Promise.resolve()
  }

  onEval(code, jupyterKernel){
    var kernel = kernels.find(kernel => {
      return kernel.jupyterKernel
        && kernel.jupyterKernel._id === jupyterKernel._id
    })

    kernel.history("CODE", code)
    monitor.send("update-kernels", this.constructor.status())
  }

  onResponse(response, jupyterKernel) {
    var kernel = this.findKernelTask(jupyterKernel)

    kernel.history("RESPONSE", response)
    monitor.send("update-kernels", this.constructor.status())
  }

  installPackage(jupyterKernel, packageName) {
    var kernel = this.findKernelTask(jupyterKernel)
    
    if ( ! kernel ) {
      return Promise.reject(
        new DeploymentError("Kernel task couldn't be found")
      )
    }

    kernel.history("INSTALLPACKAGE", packageName)

    return kernel
      .installPackage(packageName)
      .then(result => {
        kernel.history("PACKAGESINSTALLED", result)
        return Promise.resolve(result)
      })
  }

  removePackage(jupyterKernel, packageName) {
    var kernel = this.findKernelTask(jupyterKernel)

    kernel.history("REMOVEPACKAGE", packageName)

    if ( ! kernel ) {
      return Promise.reject(
        new DeploymentError("Kernel task couldn't be found")
      )
    }

    return kernel.removePackage(packageName)
      .then(result => {
        kernel.history("PACKAGEREMOVED", result)
        return Promise.resolve(result)
      })
  }

  findKernelTask(jupyterKernel) {
    return kernels.find(kernel => {
      return kernel.jupyterKernel
        && kernel.jupyterKernel === jupyterKernel
    })
  }
}

if (process.env.DEFAULT_DEPLOYMENT === "AWSECS") {
  AWSECS.setupReserves()

  monitor.on(
    "get-kernels",
    ({ data, socket }) => socket.emit("update-kernels", AWSECS.status())
  )

  monitor.on(
    "kill-kernel",
    ({ data, socket }) => AWSECS.kill(data)
  )

  monitor.on("flush", () => AWSECS.flush())

  monitor.on("set-reserve-config", ({ data }) => {
    for (var name in data) {
      var value = Number(data[name])

      if (value) {
        reserveConfig[name] = value
        AWSECS.setupReserves()
      }
    }

    monitor.send("update-reserve-config", reserveConfig)
  })

  monitor.on("get-reserve-config", ({ socket }) => {
    socket.emit("update-reserve-config", reserveConfig)
  })
}

module.exports = AWSECS
