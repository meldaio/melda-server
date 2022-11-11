const EventEmitter = require("events");
const kernelManager = require("../lib/kernel");
const { Stage, Cell, User } = require("../models");
const Queue = require("better-queue");
const UserError = require("../lib/user-error.js");

class StageQueueError extends UserError {}

module.exports = class StageQueue extends EventEmitter {
  /**
   * Sets required args.
   * @param  {String} stageId Stage id.
   * @param  {Object} user    Plain user object.
   */
  constructor(stageId, user) {
    super();
    /**
     * Stage id.
     * @type {String}
     */
    this.stageId = stageId;
    /**
     * All created kernels for this stage. Indexed by language name.
     * @type {Object}
     */
    this.kernels = {};
    /**
     * The user who started this stage (not the owner of this stage).
     * Plain user object, not a Mongoose model.
     * @type {Object}
     */
    this.user = user;
    /**
     * Array of cell ids.
     * @type {Array}
     */
    this.cellsGettingEvaluated = [];
    /**
     * Ticket id indexed history cache.
     * @see updateHistory method.
     * @type {Object}
     */
    this.historyCache = {};
    /**
     * Main queue object 
     * @type {Queue}
     */
    this.queue = new Queue(async (input, done) => {
      let { worker } = input;
      
      try {
        let result = await worker();
        done(null, result);
      } catch(err) {
        done(err);
      }
    });
    /**
     * Queue event listeners.
     * Trigger order of these events:
     * accepted > queued > started > finished|failed
     * @see updateHistory for details.
     */
    this.queue.on("task_accepted", (id, ticket) => this.updateHistory(id, "queued", ticket));
    this.queue.on("task_queued", async () => {}); // dont do anything
    this.queue.on("task_started", id => this.updateHistory(id, "started"));
    this.queue.on("task_failed", (id, error) => this.updateHistory(id, "failed", null, error));
    this.queue.on("task_finish", id => this.updateHistory(id, "finished"));
  }
  /**
   * Attaches already created kernels if there are any.
   * @return {Void}
   */
  async initKernels(user = null) {
    let model = await this.getModel();
    let project = await model.getProject();
    let kernelNames = kernelManager
      .getAttachedKernelNames(project._id.toString());

    for (let i = 0; i < kernelNames.length; i++) {
      await this.attachKernel(kernelNames[i], user);
    }
  }
  /**
   * Removes all listeners, cleans up the tasks in the queue, shutsdown all
   * opened kernels
   * @return {Void}
   */
  async shutdown() {
    let model = await this.getModel();
    let project = await model.getProject();

    if ( ! project )
      return;

    this.queue.destroy();
    this.removeAllListeners();
    await Promise.all(
      Object.keys(this.kernels).map(lang => this.shutdownKernel(lang))
    );
  }
  /**
   * Event emitter. This is just for monitoring purposes to not register a
   * listener to every event.
   */
  emit(event, ...args) {
    super.emit(event, ...args);
    super.emit("*", event, args);
  }
  /**
   * Adds a ticket to the queue and returns a promise gets resolved or rejected
   * based on ticket's "finish" and "failed" events.
   * @param  {Function} worker  Worker function. Should return a promise
   *                            resolves with the result data.
   * @param  {String}   name    Some sort of identifier (method name for most of
   *                            the cases) for this newly created ticket.
   * @param  {Object}   data    Input data.
   * @return {Promise}
   */
  addToQueue(worker, name, data, user = null, socket = null) {
    return new Promise((res, rej) => {
      let ticket = this.queue.push({ worker, name, data, user, socket });
      ticket.on("finish", res);
      ticket.on("failed", rej);
    });
  }
  /**
   * Returns stage model defined by this.stageId.
   * @return {Promise} Resolved by model
   */
  async getModel() {
    return await Stage.findById(this.stageId);
  }
  /**
   * Updates/Creates the history entry.
   * @emits  stage-error, task-queued, task-started, task-finished.
   * @param  {String} id     Ticket id.
   * @param  {String} status accepted|failed|finished.
   * @param  {String} data   Ticket data.
   * @param  {Object} error  Error object if status is failed.
   * @return {Object}        Entry object.
   */
  async updateHistory(id, status, data, error) {
    let cache = this.historyCache;

    if (status === "queued") {
      // Create a history entry in a promise.
      let prom = new Promise(async (res, rej) => {
        try {
          const model = await this.getModel();
          const entry = await model.addHistoryEntry({ id, ...data });
          this.emit("task-queued", entry);
          res(entry);
        } catch(error) {
          rej(error);
        }
      });

      // Add the property "success" to be able to understand if its created in
      // the next .then callback.
      prom = prom.then(() => cache[id].success = true)
        .catch(error => {
          cache[id].success = false;
          error = new StageQueueError("Error on creating an history entry", error);
          this.emit("stage-error", error.export());
        });

      cache[id] = { prom, success: null };
    } else {
      if ( ! cache[id] || ! cache[id].prom ) {
        let error = new StageQueueError("Error on history update");
        return this.emit("stage-error", error.export());
      }

      // Update the entry in the next then callback, after its created.
      cache[id].prom = cache[id].prom.then(async () => {
        // Don't continue if the entry is not created.
        if (cache[id].success === false)
          return;

        const model = await this.getModel();
        const entry = await model.updateHistoryEntry(id, status, error);
        // Entry might be deleted before task gets finished:
        if (entry) this.emit("task-" + status, entry);
      });

      // If this ticket is finished working completely, remove it from cache:
      if (["finished", "failed"].includes(status)) {
        cache[id].prom.then(() => {
          delete cache[id];
        })
      }
    }
  }
  /**
   * Deletes all history entries
   * @return {Void}
   */
  async clearHistory() {
    const model = await this.getModel();
    await model.clearHistory();
    this.emit("historyCleaned");
  }
  /**
   * Detaches and attaches kernel again.
   * @param  {String} language Kernel name.
   * @return {Kernel}          Newly created kernel object.
   */
  async restartKernel(language, user = null, socket = null) {
    this.detachKernel(language, user, socket);
    return this.attachKernel(language, user, socket);
  }
  /**
   * Shutsdown a kernel. This method doesn't add a worker to the queue. Use
   * detachKernel to add a worker.
   * @param  {String} language Language name
   * @return {String}          Language name
   * @emits kernel-detached
   */
  async shutdownKernel(language) {
    const kernel = this.kernels[language];
    // Kernel might be detached in a previous ticker.
    if ( ! kernel ) return language;
    delete this.kernels[language];
    // await kernel.shutdown();
    kernel.removeAllListeners();

    let model = await this.getModel();
    let project = await model.getProject();
    kernelManager.detach(language, project._id.toString());

    this.emit("kernel-detached", language);
    return language;
  }
  /**
   * Detaches all initialized kernels.
   * (adds a "detach" for each opened kernel)
   * @return {Void}
   */
  async detachAllKernels() {
    return await Promise.all(
      Object
        .keys(this.kernels)
        .map(language => this.detachKernel(language))
    );
  }
  /**
   * Returns an array of currently running kernels's info objects.
   * @param  {Boolean} includeDetails Gets passed to this.getKernelInfo.
   * @return {Array}
   */
  getAllKernelInfos(includeDetails = false) {
    let result = {};
    Object.values(this.kernels)
      .map(kernel => this.getKernelInfo(kernel, includeDetails))
      .forEach(kernel => result[kernel.language] = kernel);
    return result
  }
  /**
   * Returns kernel info object.
   * @param  {Mixed}   kernel         Kernel name or kernel object.
   * @param  {Boolean} includeDetails true: adds detailed info like ip, ports
   *                                  etc...
   * @return {Object}                 Kernel info object.
   */
  getKernelInfo(kernel, includeDetails = false) {
    if (typeof kernel === "string") {
      kernel = this.kernels[kernel];
      if ( ! kernel )
        throw new StageQueueError("Kernel " + kernel + " not found");
    }

    const result = {
      language: kernel.name,
      status: kernel.status
    };

    // this should be removed on the endpoint or includeDetails should be false
    // for non-admin users.
    if (includeDetails) result.info = kernel.creationData;

    return result
  }
  /**
   * Runs code on the kernel without saving it.
   * @param  {String} language Kernel name.
   * @param  {String} code     Code to run.
   * @return {Object}          globals, output, error, stderr.
   */
  async runCode(language, code) {
    const kernel = this.kernels[language];

    if ( ! kernel || ! kernel.ready )
      throw new StageQueueError("Kernel is not ready");

    // Actual evaluation.
    let { prom, future } = kernel.eval(code || "");

    future.onStream(out => {
      this.emit("update-console", language, out)
    });
    
    return await prom;
  }
  /**
   * Creates a kernel for the given language. Returns the kernel if its already
   * created.
   * @emits  kernel-status-update, kernel-creation-progress
   *         kernel-creation-failed
   * @param  {String}  language Language name.
   * @return {Kernel}           Attached kernel object
   */
  async attachKernel(language, user = null, socket = null) {
    const isAdmin = user ? user.admin : false;

    const worker = async () => {
      if (this.kernels[language])
        return this.kernels[language];

      let kernelResource = "1";

      if (user && user._id) {
        let userRecord = await User.findById(user);
        if (userRecord)
          kernelResource = userRecord.subscription;
      }

      let model = await this.getModel();
      let project = await model.getProject();

      if ( ! project || ! project._id )
        throw new StageQueueError("Project couldn't be found");

      let kernel = kernelManager.attach(
        language,
        user,
        project._id.toString(),
        kernelResource
      );

      this.kernels[language] = kernel;

      kernel.on("status-update", () => {
        this.emit("kernel-status-update", this.getKernelInfo(kernel, isAdmin));
      });

      // Initialize the kernel and start the creationJob.
      let prom = kernel.init();

      // Some kernels might not have a creationJob (like HTML and Markdown).
      if (kernel.creationJob) {
        kernel.creationJob.on("progress", (finished, obj) => {
          let message = obj.message || "";
          let data = obj;
          this.emit("kernel-creation-progress", { language, finished, data, message });
        });

        kernel.creationJob.on("failed", error => {
          error = new StageQueueError("Kernel creation failed", error);
          console.error(error);
          this.emit("kernel-creation-failed", { language, error: error.export() });
        });
      }

      return await prom
    }

    return this.addToQueue(worker, "attachKernel", { language }, user, socket);
  }
  /**
   * Detaches kernel given with its name.
   * @param  {String} language Kernel name.
   * @return {String}          Language (kernel name).
   */
  async detachKernel(language, user = null, socket = null) {
    const worker = () => this.shutdownKernel(language);
    return this.addToQueue(worker, "detachKernel", { language }, user, socket);
  }
  /**
   * Sends interrupt message to the kernel given with its name.
   * This doesn't add a ticket to the queue.
   * @param  {String} language Kernel name.
   * @return {String}          Language (kernel name).
   */
  async interruptKernel(language, user = null, socket = null) {
    const kernel = this.kernels[language];
    // Kernel might be detached in a previous ticker.
    if ( ! kernel ) return language;
    kernel.interrupt();
    return language;
  }
  /**
   * Creates a cell record without evaluating it.
   * @param  {String}  language Language name. See lib/kernel.
   * @param  {Number}  index    Index of the cell in this stage.
   * @return {Promise}
   */
  async createCell(language, index = null, user, socket) {
    let worker = async () => {
      let model = await this.getModel();
      return await model.createCell(language, index);
    }

    return this.addToQueue(worker, "createCell", { language, index }, user, socket);
  }
  /**
   * Deletes a cell from this stage.
   * @param  {String}  id Cell id.
   * @return {Promise}
   */
  async deleteCell(id, user = null, socket = null) {
    let worker = async () => {
      let model = await this.getModel();
      return await model.deleteCell(id);
    }

    return this.addToQueue(worker, "deleteCell", { id }, user, socket);
  }
  /**
   * Saves cell code, marks cell as not evaluted.
   * @param  {String}  id   Cell id.
   * @param  {String}  code Code to save.
   * @return {Promise}
   */
  async saveCellCode(id, code, user = null, socket = null) {
    let worker = async () => {
      let model = await this.getModel();
      return await model.updateCellCode(id, code);
      return cell;
    }

    return this.addToQueue(worker, "saveCellCode", { id, code }, user, socket);
  }
  async evalCode(language, code, user = null, socket = null) {
    await this.attachKernel(language, user, socket);
    let kernel = this.kernels[language];
    if ( ! kernel ) throw new StageQueueError("Kernel is dead.");
    let { prom } = await kernel.eval(code || "");
    return prom;
  }
  /**
   * Updates cells "code" property and evaluates it.
   * @param  {String}  id       Cell id.
   * @param  {String}  code     Cell code.
   * @param  {String}  language Cell language.
   * @return {Promise}
   */
  async evalCell(id, language, code, user = null, socket = null) {
    console.log('cell will be evaluated', process.memoryUsage())
    // Create the kernel if its not created yet.
    this.attachKernel(language, user, socket);
    console.log('kernel attached', process.memoryUsage())

    let worker = async () => {
      let model = await this.getModel();
      let project = await model.getProject();
      let cell = await model.updateCellCode(id, code);
      console.log('cell code updated', process.memoryUsage())
    
      // Get kernel. Create if there isn't any.
      let kernel = this.kernels[cell.language];
      if ( ! kernel ) throw new StageQueueError("Kernel is dead.");

      // Actual evaluation.
      if (project.variables) {
        project.variables.map((variable) => {
          if (language === 'R') kernel.eval(`Sys.setenv("${variable.name}" = "${variable.value}")`);
          if (language === 'Python') kernel.eval(`os.environ["${variable.name}"] = "${variable.value}"`);
        })
      }
      let { prom, future } = kernel.eval(cell.code || "");
      if (future) {
        future.onContent(async ({ error, output, stderr }) => {
          // Since this is an async block inside an async event listener we need
          // to catch errors separately.
          try {
            Object.assign(cell, { error, output, stderr });
            this.emit("update-cell-output", cell.export());
            // when future.onContent is faster than cell.save, it causes
            // document version error. so we are not saving results until the
            // evaluation finishes (for now):
            // await cell.save();
          } catch(err) {
            this.emit("stage-error", UserError.wrap(err).export());
          }
        });
      }
      const { globals, dependencies, output, error, stderr } = await prom;
      const evaluated = true;
      cell = await model.getCell(id);
      Object.assign(cell, { dependencies, error, output, stderr, evaluated });

      let _globals = (model.globals || [])
        .filter(item => !!item)
        .filter(item => item.language !== language)
        .concat(globals)
        .filter(item => !!item);
      
      model.globals = _globals
      await model.save()
      this.emit("set-globals", model.globals)
      
      return await cell.save();
    }
    console.log('eval cell will be added to queue', process.memoryUsage())
    return this.addToQueue(worker, "evalCell", { id, code }, user, socket);
  }
  /**
   * Sets cell properties.
   * @param  {String}  id     Cell id.
   * @param  {Object}  props  Properties object to set.
   * @return {Promise}
   */
  async setCellProps(id, props, user = null, socket = null) {
    let worker = async () => {
      const stage = await this.getModel();
      return await stage.setCellProps(id, props);
    }

    return this.addToQueue(worker, "setCellProps", { id, props }, user, socket);
  }
  /**
   * Swaps 2 cell indexes with each other depending on direction.
   * @param  {String}  id        Cell id to move up or down.
   * @param  {String}  direction up|down
   * @return {Promise}
   */
  async moveCell(id, direction, user = null, socket = null) {
    let worker = async () => {
      const stage = await this.getModel();
      return await stage.moveCell(id, direction);
    }

    return this.addToQueue(worker, "moveCell", { id, direction }, user, socket);
  }
  /**
   * Move a cell to an exact position given with "index" argument.
   * @param  {String}  id    Cell id.
   * @param  {Number}  index Index to move (starts from 1, not 0).
   * @return {Promise}
   */
  async moveCellTo(id, index, user = null, socket = null) {
    let worker = async () => {
      const stage = await this.getModel();
      return await stage.moveCellTo(id, index);
    }

    return this.addToQueue(worker, "moveCellTo", { id, index }, user, socket);
  }





  async testTask() {
    let worker = async () => {
      await sleeping(2);
    }
    return this.addToQueue(worker, "testTask");
  }
}




function sleeping(seconds = 2) {
  return new Promise(res => setTimeout(res, seconds * 1000))
}