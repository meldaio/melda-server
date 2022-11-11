const KernelError = require("./error");
const kue = require("kue");
const Jupyter = require("@jupyterlab/services");
const EventEmitter = require("events");

const { REDIS_PORT, REDIS_HOST } = process.env;

const queue = kue.createQueue({ redis: { port: REDIS_PORT, host: REDIS_HOST } });

let kernelStack = [];

let RESOURCE_OPTIONS = {
  "1": { memory: 1900, cpu: 512 }, // 2 GB RAM 0.5 CPU
  "2": { memory: 1900, cpu: 512 }, // 2 GB RAM 0.5 CPU
  "3": { memory: 3800, cpu: 1024 }, // 4 GB RAM 1 CPU
  "4": { memory: 7600, cpu: 2048 }, // 8 GB RAM 2 CPU
  "5": { memory: 7600, cpu: 2048 } // 8 GB RAM 2 CPU
};

/**
 * Kernel is an interface for language kernels. Also abstracts Jupyter
 * Services' kernel objects.
 * @interface
 */
module.exports = class Kernel extends EventEmitter {
  /**
   * Creates an instance of this kernel and runs init. Returns a Promise
   * resolved with kernel instance itself.
   * @return {Promise}
   */
  static create(...args) {
    //return (new this(...args)).init()
    return new this(...args)
  }

  static flushOrphans() {
    let strategy = process.env.DEFAULT_DEPLOYMENT
    let inUse = kernelStack
      .filter(kernel => !!kernel.creationData)
      .map(kernel => kernel.creationData.arn)

    queue.create("flush orphan kernels", { strategy, inUse }).save()
  }
  /**
   * Sets properties and registers.
   */
  constructor(user, project, resource = "1") {
    super()
    /**
     * Kernel name (language name). Has to be set by subclass.
     * @type {String}
     * @required
     */
    this.name = null
    /**
     * User object
     * @type {Object}
     */
    this.user = user
    /**
     * Jupyter container's resource option. Check RESOURCE_OPTIONS.
     * @type {String}
     */
    this.resource = resource;
    /**
     * Project id
     * @type {String}
     */
    this.project = project
    /**
     * Jupyer IP or hostname.
     * @type {String}
     */
    this.jupyterHost = null;
    /**
     * Jupyter port.
     * @type {Number}
     */
    this.jupyterPort = null;
    /**
     * Jupyter Service Kernel object name. Has to be set by subclass if
     * jupyter kernel object is required.
     * @type String
     */
    this.jupyterKernelName = null
    /**
     * Jupyter Service Kernel object. Set by init. Only available if
     * jupyterKernelName is set.
     * @type {Object}
     */
    this.jupyterKernel = null
    /**
     * Kue job object for kernel creation.
     * @type {Object}
     */
    this.creationJob = null
    /**
     * Creation worker's returned result
     * @type {Object}
     */
    this.creationData = null

    this.shutdownJob = null

    this.shuttingDown = false

    this.ready = false

    /**
     * Kernel status. Possible values:
     * - initialization
     * - shuttingdown
     * - connected
     * - busy
     * - idle
     * @type {String}
     */
    this.status = "initialization"

    this.lastExecution = new Date

    this.isMarkup = false

    kernelStack.push(this)
  }
  /**
   * Creates the Jupyter Service Kernel instance and stores it to
   * jupyterKernel property. Returns a promise resolved with kernel instance
   * itself.
   * @return {Promise}
   */
  async init() {
    this.status = "initialization"
    this.emit("status-update", this.status)

    let resources = RESOURCE_OPTIONS[this.resource] || RESOURCE_OPTIONS["1"];

    this.creationJob = queue.create("create jupyter", {
      strategy: process.env.DEFAULT_DEPLOYMENT,
      project: this.project,
      user: this.user,
      ...resources
    })

    this.creationJob.searchKeys(["project", "title"])
    this.creationJob.save()

    return new Promise((res, rej) => {
      let rejected = false;

      this.creationJob.on("failed", error => {
        !rejected && rej(error);
        rejected = true;
      });

      this.creationJob.on("complete", async creationData => {
        if (rejected) return false;
        this.creationData = creationData;

        const name = this.jupyterKernelName
        const serverSettings = await this.getServerSettings();

        const kernelManager = new Jupyter.KernelManager({ serverSettings });
        const kernelList = await Jupyter.KernelAPI.listRunning(serverSettings);
        const model = kernelList.find(kernel => kernel.name === name);

        if (model) {
          this.jupyterKernel = await kernelManager.connectTo({ model });
        } else {
          this.jupyterKernel = await kernelManager.startNew({ name });
        }

        this.jupyterKernel.statusChanged.connect(kernel => {
          this.status = kernel.status;
          this.emit("status-update", this.status);
        })

        res(this);
        this.ready = true;
        this.emit("ready", this);

        this.lastExecution = new Date;
        this.constructor.flushOrphans();

        return this.jupyterKernel;
      });
    });
  }
  /**
   * Evaluates a code string. Returns a Promise resolved with result object
   * which contains code itself, outputs and errors.
   * @param  {String} code Code to evaluate
   * @return {Promise}
   */
  eval(code) {
    if ( ! this.jupyterKernel ) {
      return Promise.reject(new KernelError("Kernel is dead"))
    }
    this.lastExecution = new Date

    var output = []
    var error = []
    var stderr = []

    let future = this.jupyterKernel.requestExecute({ code })
    let prom = new Promise(async (res, rej) => {
      await future.done
      res({ code, output, error, stderr })
    })

    let onContentCallbacks = [];
    let onStreamCallbacks = [];
    future.onContent = cb => onContentCallbacks.push(cb);
    future.onStream = cb => onStreamCallbacks.push(cb);

    const msgTypes = ["display_data", "execute_result", "error", "stream"];

    future.registerMessageHook(({ content, msg_type }) => {
      if ( ! msgTypes.includes(msg_type) )
        return;

      let _output, _error, _stderr;

      if (content.name === "stdout" || content.data)
        _output = content;

      if (msg_type === "error")
        _error = content;

      if (msg_type === "stream") {
        if (content.name === "stderr")
          _stderr = content.text;
      }

      _output && output.push(_output);
      _error && error.push(_error);
      _stderr && stderr.push(_stderr);

      onContentCallbacks.forEach(cb => cb({ code, output, error, stderr }));
      onStreamCallbacks.forEach(cb => cb({
        code,
        output: _output,
        error: _error,
        stderr: _stderr
      }));
    })

    return { future, prom }
  }
  /**
   * Shutdowns the kernel provided by Jupyter Service.
   * @return {Promise}
   */
  async shutdown() {
    if (this.shuttingDown) {
      return;
    }

    this.status = "shuttingdown"
    this.emit("status-update", this.status)

    this.shuttingDown = true

    let shutdownFunc = async () => {
      await this.jupyterKernel.shutdown();
      // Completely shutdown a jupyter
      const serverSettings = await this.getServerSettings();
      const kernelList = await Jupyter.KernelAPI.listRunning(serverSettings);

      if ( ! kernelList.length ) {
        this.shutdownJob = queue.create("shutdown jupyter", this.creationData);
        this.shutdownJob.save()
      }
    }

    if ( ! this.ready ) {
      return new Promise((res, rej) => {
        this.on("ready", async () => {
          await shutdownFunc();
          res();
        })
      })
    } else {
      return shutdownFunc()
    }
  }
  /**
   * Installs a package for this language.
   * This method is optional.
   * @parma  {String}  name Package name
   * @return {Promise}      Will be resolved when installing is finished
   */
  installPackage(name) {
    this.lastExecution = new Date
    return this.deployment.installPackage(this.jupyterKernel, name)
  }
  /**
   * Removes the package for this language.
   * @param  {String}  name Package name
   * @return {Promise}      Will be resolved when removing is finished
   */
  removePackage(name) {
    this.lastExecution = new Date
    return this.deployment.removePackage(this.jupyterKernel, name)
  }

  autocomplete(code, cursor_pos) {
    this.lastExecution = new Date

    if (this.jupyterKernel) {
      return this.jupyterKernel
        .requestComplete({ code, cursor_pos })
        .then(({ content }) => {
          if (content && content.matches) {
            return content.matches
          }

          return []
        })
        .catch(err => {
          console.error("request complete error", err)
        })
    }

    return []
  }

  getPackages() {
    return []
  }

  async interrupt() {
    this.lastExecution = new Date
    if (this.jupyterKernel) {
      await this.jupyterKernel.interrupt();
    }
  }

  async getServerSettings() {
    const { ports, host } = this.creationData;
    return Jupyter.ServerConnection.makeSettings({
      baseUrl: "http://"+ host +":"+ ports[0] +"/",
      wsUrl: "ws://"+ host +":"+ ports[0] +"/",
    });
  }
}
