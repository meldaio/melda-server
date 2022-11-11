const io = require("socket.io");
const { COOKIE_SECRET, CORS_ALLOWED_ORIGINS } = process.env;
const initStageNS = require("./stage");
const initClassroomNS = require("./classroom");
const initAdminNS = require("./admin");
const { SocketAuthorizationError } = require("./utils");
const sessionParser = require('../lib/session-parser')
// const wildCardMiddleware = require('socketio-wildcard')();

module.exports = {
  init(server) {
    // Main web socket server.
    const WS_SERVER = io(server, { path: "/socket", handlePreflightRequest });
    
    // Authorization middleware.
    WS_SERVER.use(async (socket, next) => {
      await new Promise((res, rej) => {
        sessionParser(socket.request, {}, () => {
          res(socket.request.session)
        })
      })
      try {
        const user = socket.request.session.user
        
        if (!user) {
          throw new SocketAuthorizationError("Unauthorized user")
        }
      } catch (err) {
        if (err instanceof SocketAuthorizationError) {
          return next(err);
        } else {
          console.error(err);
          return next(new SocketAuthorizationError("Unknown authorization error"));
        }
      }

      // Continue to namespace middlewares
      next();
    })

    // Initialize namespaces
    initAdminNS(WS_SERVER);
    initStageNS(WS_SERVER);
    initClassroomNS(WS_SERVER);

    return WS_SERVER;

















    let stageNs = wsServer.of("/stage")
    let adminNs = wsServer.of("/admin")

    adminNs.use((socket, next) => {
      console.log("NS:", socket.nsp.name)
    })

    stageNs
      // .use(wildCardMiddleware)
      .use((socket, next) => {
        console.log("NS:", socket.nsp.name)
        console.log(socket.user)
      })
      .on("connection", socket => {
        if ( ! socket.user ) {
          socket.disconnect(true)
        }

        // Connection established
        this.emit("connection", socket)

        // Emit disconnect, remove namespace
        socket.on("disconnect", () => this.emit("disconnect", socket))

        // On namespace request
        socket.on("namespace", name => {
          var { namespace, created } = Namespace.create(name, socket)

          // Emit "namespace" event if created
          created && this.emit("namespace", namespace)

          socket.emit("joined", namespace.name)
        })
      })
  }
}

function handlePreflightRequest(req, res) {
  let allowedOrigins = CORS_ALLOWED_ORIGINS.split(";");

  if (allowedOrigins.includes(req.headers.origin)) {
    res.writeHead(200, {
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Origin': req.headers.origin,
      'Access-Control-Allow-Credentials': true
    });
  }

  res.end();
}