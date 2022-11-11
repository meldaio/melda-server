const RouteError = require("../../route-error.js");

module.exports = class AuthError extends RouteError {
  /**
   * Sets status to 401 as default.
   * @param  {String} message
   * @param  {Number} status
   */
  constructor(message, status = 401, ...params) {
    super(message, status, ...params);
  }
}