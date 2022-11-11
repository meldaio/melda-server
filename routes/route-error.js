const UserError = require("../lib/user-error.js");

module.exports = class RouteError extends UserError {
  /**
   * HTTP status code.
   * @type {Number}
   */
  status = null
  /**
   * @param  {String} message
   * @param  {Number} status
   * @param  {Object} originalError
   */
  constructor(message, status = 500, ...params) {
    super(message, ...params);
    this.status = status;
  }
  /**
   * Includes status parameter to exported error data.
   * @return {Object}
   */
  export(...params) {
    const obj = super.export(...params);
    obj.status = this.status;
    return obj;
  }

  static create(...args) {
    return new this(...args);
  }

  static wrap(error, message = "Unknown Error", status = 500) {
    if (error instanceof this)
      return error;
    return this.create(message, status, error);
  }

}