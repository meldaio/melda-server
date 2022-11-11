const { SocketError, getUserFromSocket, getSocketsFromUser } = require("./utils");
const stageManager = require("../lib/stage-manager.js");
const { Project, Stage, Cell } = require("../models");
const wildcardMiddleware = require('socketio-wildcard')();
const UserError = require("../lib/user-error.js");

class StageSocketError extends SocketError {  }
class AlreadyRunningStage extends StageSocketError {  }

const EXCLUDE_FROM_WILDCARD = ["join", "leave", "forceShutdown"];
const MESSAGE_ID_REGEXP = /^(.+)___(.+)$/

module.exports = function(WS_SERVER) {
  const server = WS_SERVER.of("/stage");

  stageManager.on("stage-attached", stage => {
    stage.on("*", (event, data) => {
      server.to(stage.stageId).emit(event, ...data);
    });
  });

  server.use(wildcardMiddleware).on("connection", socket => {
    let user = getUserFromSocket(socket);
    /**
     * Passes every event to stageQueue except the ones inside
     * EXCLUDE_FROM_WILDCARD.
     * @param  {Object}
     */
    socket.on("*", async ({ data }) => {
      const [event, ...inputs] = data;

      if (EXCLUDE_FROM_WILDCARD.includes(event))
        return;

      let methodName = event;
      let messageId;

      // If event name contains a message id:
      if (MESSAGE_ID_REGEXP.test(event)) {
        let matches = event.match(MESSAGE_ID_REGEXP);
        methodName = matches[1];
        messageId = matches[2];
      }

      // Find the stage id from this socket's rooms.
      const stageId = getStageId(socket);

      try {
        if ( ! stageManager.isInitialized(stageId) )
          throw new StageSocketError("Stage is not initialized. Try 'join' first.");

        const stage = stageManager.getInstance(stageId, user);
        /*
        if (stage.detachTimeout) {
          clearTimeout(stage.detachTimeout);
          stage.detachTimeout = null;
        }
        */

        if ( ! stage[methodName] )
          throw new StageSocketError("Method not found");

        const result = await stage[methodName](...inputs, user);

        // If there is a messageId, the client is waiting for response with
        // the same id.
        if (messageId) socket.emit(event, result);
      } catch(error) {
        if (messageId) socket.emit(event, { ___error: handleError(error) });
        socket.emit("stage-error", handleError(error));
      }
    });
    /**
     * Join request to the stage.
     * @param  {String} stageId
     */
    socket.on("join", async stageId => {
      try {
        // if ( ! await isAllowed(stageId, user) )
        //   throw new StageSocketError("Not allowed");

        let sockets = getSocketsFromUser(user, server);
        for (let i = 0; i < sockets.length; i++) {
          let id = getStageId(sockets[i]);
          if (id && id !== stageId) {
            //throw new AlreadyRunningStage("You are already using another stage");
          }
        }

        socket.join(stageId); // Join this stage's room.

        const stage = stageManager.getInstance(stageId, user);
        /*
        if (stage.detachTimeout) {
          clearTimeout(stage.detachTimeout);
          stage.detachTimeout = null;
        }
        */
        socket.emit("join-complete", stageId);

        const model = await stage.getModel();
        const project = await Project.findById(model.project).populate("owner");

        const stageObject = await model.exportPopulated();
        const projectObject = await project.exportTree(stageId);

        socket.emit("initialize", {
          project: projectObject,
          stage: stageObject,
          cellsGettingEvaluated: stage.cellsGettingEvaluated,
          runningKernels: stage.getAllKernelInfos(user.admin)
        });

        // Init already running kernels
        await stage.initKernels(user);

      } catch(error) {
        socket.emit("stage-error", handleError(error));
      }
    });
    /**
     * Temporarily: Detaches stage opened by this user.
     * Note: the difference between "disconnecting" and "disconnect" events is,
     * when "disconnecting" happens, user still is inside room.
     */
    socket.on("disconnecting", () => leaveStage(socket));
    socket.on("leave", () => leaveStage(socket));
  });

  /*
  server.use(async (socket, next) => {
    try {
      let { query } = socket.handshake
      if ( ! query.uri )
        throw new StageSocketError("Stage uri is missing")
    } catch(err) {
      return next(err)
    }
    next();
  })
  */

  function handleError(error) {
    if ( ! (error instanceof UserError) ) {
      error = new StageSocketError("Unknown error", error);
      console.error(error);
    }
    return error.export();
  }

  function getStageId(socket) {
    return Object.values(socket.rooms)
      .find(room => room.match(/^[a-f0-9]{24}$/));
  }

  function leaveStage(socket) {
    const stageId = getStageId(socket);
    const room = server.adapter.rooms[stageId];
    // since user hasn't left the room yet, continue if there is more than 1
    // socket in the room
    if ( ! (room && room.length > 1) ) {
      socket.leave(stageId);

      if (stageManager.isInitialized(stageId)) {
        stageManager.detachStage(stageId)
        /*
        let stage = stageManager.getInstance(stageId);
        if (stage.detachTimeout) {
          clearTimeout(stage.detachTimeout);
          stage.detachTimeout = null;
        }

        stage.detachTimeout = setTimeout(
          () => stageManager.detachStage(stageId),
          process.env.STAGE_DETACHING_TIMEOUT
        );
        */
      }
    }
  }

  async function isAllowed(_id, owner) {
    let stage = await Stage.findOne({ _id, owner });
    return !!stage;
  }
}






