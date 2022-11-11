const jwt = require("jsonwebtoken");
const UserError = require("../lib/user-error.js");
const { JWT_SECRET } = process.env;

class SocketError extends UserError {  }
class SocketAuthorizationError extends SocketError {  }

/**
 * Returns user from the socket.io's socket object. This function doesn't do
 * any auth check since it should've been done in main socket's middleware.
 * @param  {Socket} socket socket.io's socket object.
 * @return {Object}        User object (plain object).
 */
function getUserFromSocket(socket) {
  return socket.request.session.user
}

function getSocketsFromUser(user, server) {
  let sockets = Object.values(server.sockets);
  return sockets.filter(socket => {
    try {
      let socketsUser = getUserFromSocket(socket);
      if (socketsUser._id.toString() === user._id.toString()) {
        return true;
      }
      return false;
    } catch(err) {
      return false;
    }
  })
}

module.exports = {
  SocketError,
  SocketAuthorizationError,
  getUserFromSocket,
  getSocketsFromUser
}