const DeploymentError = require("./error")
const EventEmitter = require("events")

// All created deployment objects
var allDeploymentObjects = {}

/**
 * Deployment driver interface.
 * Required methods in subclasses: init, startKernel, shutdownKernel.
 * @interface
 */
module.exports = class Deployment {
  /**
   * Creates or returns user's deployment object.
   * @param  {Object}     user Logged in user.
   * @return {Deployment}
   */
  static get(user) {
    var obj

    if ( ! allDeploymentObjects[user._id] ) {
      obj = new this(user)
      allDeploymentObjects[ user._id ] = obj
    }

    return allDeploymentObjects[ user._id ]
  }
  /**
   * Assigns properties.
   * @param  {Object} user Logged in user.
   */
  constructor(user) {
    /**
     * User object
     * @type {Object}
     */
    this.user = user
    /**
     * Deployment object is ready.
     * @type {Boolean}
     */
    this.deploymentReady = false
    /**
     * Callbacks to run after deployment gets ready.
     * @type {Array}
     */
    this.readyCallbacks = []
  }
  /**
   * Required in the subclass.
   * @required
   * @return {Promise} Resolved with this object.
   */
  init() {}
  /**
   * Required in the subclass. Important: this.init() needs to be ran in the
   * subclass's startKernel first.
   * @required
   * @param    {String}  kernelName Jupyter kernel name.
   * @return   {Promise}            Resolved with Jupyter service kernel object.
   */
  startKernel(kernelName) {}
  /**
   * Required in the sublcass.
   * @required
   * @param    {String}  jupyterKernel Jupyter service kernel object.
   * @return   {Promies}
   */
  shutdownKernel(jupyterKernel) {}
  /**
   * Registers a ready callback. If callback is not passed, triggers all
   * callbacks. Important: Don't override in subclasses.
   * @readOnly
   * @param    {Function}   callback Ready callback function
   * @return   {Deployment}          this
   */
  ready(callback) {
    var _callback

    if ( ! callback ) {
      this.deploymentReady = true
    } else {
      this.readyCallbacks.push(callback)
    }

    if (this.deploymentReady) {
      while (_callback = this.readyCallbacks.shift()) {
        _callback.call(this)
      }
    }

    return this
  }
  /**
   * Returns true if deployment initialization is completed.
   * @return {Boolean}
   */
  isReady() {
    return this.deploymentReady
  }

  installPackage(name) {
    return Promise.reject(
      new DeploymentError("Deployment driver doesn't support package management")
    )
  }

  removePackage(name) {
    return Promise.reject(
      new DeploymentError("Deployment driver doesn't support package management")
    )
  }
}
