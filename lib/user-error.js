const { uuid } = require("./utils.js");

module.exports = class UserError extends Error {
  /**
   * Random UUID.
   * @type {String}
   */
  id = null
  /**
   * Error message.
   * @type {String}
   */
  message = null
  /**
   * Error class name.
   * @type {String}
   */
  type = null
  /**
   * Original internal error.
   * @type {Object}
   */
  originalError = null
  /**
   * Original internal error type.
   * @type {Object}
   */
  originalErrorType = null
  /**
   * Original error's stack trace.
   * @type {String}
   */
  originalErrorStack = null
  /**
   * @param  {String} message
   * @param  {Object} originalError
   */
  constructor(message, originalError = null) {
    super(message);
    this.message = message;
    this.originalError = originalError;
    this.message = message;
    this.type = this.constructor.name;
    this.id = uuid();
  }
  /**
   * Exports serializable error data to plain object.
   * @return {Object}
   */
  export(includeOriginalError = false) {
    if (process.env.NODE_ENV === "development")
      includeOriginalError = true;

    const obj = {
      message: this.message,
      type: this.type,
      stack: this.stack
    };

    if (includeOriginalError) {
      if (this.originalError
          && this.originalError.toString
          && this.originalError.toString()) {
        obj.originalError = this.originalError.toString();
        obj.originalErrorType = this.originalError.constructor.name;
        obj.originalErrorStack = this.originalError.stack;
      }
    }

    return obj;
  }

  static create(...args) {
    return new this(...args);
  }

  static wrap(error, message = "Unknown Error") {
    if (error instanceof this)
      return error;
    return this.create(message, error);
  }
}