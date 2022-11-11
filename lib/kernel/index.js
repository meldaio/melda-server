const R           = require("./r");
const Python      = require("./python");
const HTML        = require("./html");
const Markdown    = require("./markdown");
const KernelError = require("./error");

const allKernels = { R, Python, HTML, Markdown };

const { KERNEL_DETACHING_TIMEOUT } = process.env;
/**
 * All created kernels indexed by project id.
 * @type {Object}
 */
const INSTANCES = {};

module.exports = {
  /**
   * Creates a Kernel instance of the given language and returns a promise
   * resolved with that instance.
   * @param  {String}  name Language name
   * @return {Promise}
   */
  create(name, ...args) {
    console.log("CREATED")
    if ( ! allKernels[name] || ! allKernels[name].create )
      throw new KernelError("Kernel '" + name + "' not found")

    return allKernels[name].create(...args);
  },

  getAttachedKernelNames(project) {
    let kernels = INSTANCES[project] || {};
    return Object.keys(kernels);
  },
  /**
   * Attaches a kernel to the given project. Returns the already created kernel
   * or creates a new one if there isn't any.
   * @param  {String} name     Kernel name
   * @param  {String} project  Project id
   * @param  {String} resource Resource type (check kernel interface)
   * @return {Kernel}          Kernel instance
   */
  attach(name, user, project, resource = "1") {
    if ( ! allKernels[name] || ! allKernels[name].create )
      throw new KernelError("Kernel '" + name + "' not found")

    if ( ! INSTANCES[project] )
      INSTANCES[project] = {};

    if ( ! INSTANCES[project][name] )
      INSTANCES[project][name] = this.create(name, user, project, resource);

    let kernel = INSTANCES[project][name];

    if (kernel.detachTimeout)
      clearTimeout(kernel.detachTimeout);

    return kernel;
  },
  /**
   * Detaches kernels. Waits for KERNEL_DETACHING_TIMEOUT before closing it
   * completely.
   * @param  {String} name    Kernel name
   * @param  {String} project Project id
   * @return {Void}
   */
  detach(name, project) {
    if ( ! INSTANCES[project] || ! INSTANCES[project][name])
      return;

    let kernel = INSTANCES[project][name];

    if (kernel.detachTimeout)
      clearTimeout(kernel.detachTimeout);

    kernel.detachTimeout = setTimeout(async () => {
      delete INSTANCES[project][name];

      if (Object.keys(INSTANCES[project]).length === 0)
        delete INSTANCES[project];

      await kernel.shutdown();
      kernel.removeAllListeners();
    }, KERNEL_DETACHING_TIMEOUT);
  },
  /**
   * All available kernels' names
   * @return {Array}
   */
  all() {
    return Object.keys(allKernels).map(name => {
      let { isMarkup, aceMode } = allKernels[name];
      return { name, aceMode, isMarkup };
    })
  }
}