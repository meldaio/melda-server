const { SocketAuthorizationError, getUserFromSocket } = require("./utils.js");
const stageManager = require("../lib/stage-manager.js");
const io = require("socket.io");
const { logEmitter } = require("../lib/log.js");
const { Project, Stage, Cell } = require("../models");
const tests = require("../lib/tests");

const runningTests = [];
const workingTests = [];


module.exports = function(WS_SERVER) {
  let server = WS_SERVER.of("/admin");
  logEmitter.on("write", (type, text) => {
    server.emit("server-log", type, text);
  });

  stageManager.on("stage-attached", async stage => {
    server.emit("stage-attached", await getInfo(stage));

    stage.on("*", async (event, data) => {
      server.emit("update-stage", await getInfo(stage));
    });
  });

  stageManager.on("stage-detached", stage => {
    server.emit("stage-detached", stage.stageId);
  });

  server.use((socket, next) => {
    try {
      const user = getUserFromSocket(socket);
      if ( ! user.admin ) {
        throw new SocketAuthorizationError("Only admins are allowed");
      }
    } catch(err) {
      if (err instanceof SocketAuthorizationError) {
        return next(err);
      } else {
        return next(new SocketAuthorizationError("Unknown authorization error"));
      }
    }

    next();
  });

  server.on("connection", async socket => {
    const user = getUserFromSocket(socket);

    // Initialize.
    let stages = await Object.values(stageManager.getAllInstances());
    let allStages = await getAllInfo(user)
    
    const stageDatas = []

    for (let i = 0; i < stages.length; i++) {
      let data = await getInfo(stages[i]);
      stageDatas.push(data);
    }

    // Send all stage infos at once on connection established.
    socket.emit("initialize", {
      tests,
      runningTests,
      workingTests,
      stages: stageDatas,
      allStages
    });

    socket.on("start-test", async (id, inputs) => {
      const test = tests[id];
      if ( ! test ) return;
      runningTests.push(id);
      workingTests.push(id);
      socket.emit("running-tests", runningTests);
      socket.emit("working-tests", workingTests);
      await test.start(inputs);
      workingTests.splice(workingTests.indexOf(id), 1);
      socket.emit("working-tests", workingTests);
    });

    socket.on("stop-test", id => {
      let test = tests[id];

      runningTests.splice(runningTests.indexOf(id), 1);
      if (test) {
        workingTests.splice(workingTests.indexOf(id), 1);
        runningTests.splice(runningTests.indexOf(id), 1);
        test.stop();
      }
      socket.emit("working-tests", workingTests);
      socket.emit("running-tests", runningTests);
    });
    
    socket.on("detachKernel", (stageId, language) => {
      if (stageManager.isInitialized(stageId)) {
        let stage = stageManager.getInstance(stageId);
        stage.detachKernel(language);
      }
    });

    socket.on("restartKernel", (stageId, language) => {
      if (stageManager.isInitialized(stageId)) {
        let stage = stageManager.getInstance(stageId);
        stage.restartKernel(language);
      }
    });

    socket.on("interruptKernel", (stageId, language) => {
      if (stageManager.isInitialized(stageId)) {
        let stage = stageManager.getInstance(stageId);
        stage.interruptKernel(language);
      }
    });

    socket.on("forceShutdown", stageId => {
      stageManager.detachStage(stageId);
    });
    
  });
}


/**
 * Returns the basic information about the stage to show on administration GUI.
 * @param  {Stage}  stage Stage model object.
 * @return {Object}       Info object.
 */
async function getInfo(stage) {
  const model = await stage.getModel();
  await model.populate("history").execPopulate();

  return {
    stage: await getStageHistoryWithCellIndex(model.export()),
    runningKernels: stage.getAllKernelInfos(),
  }
}
/**
 * Returns the basic information about the all 
 * stages to show on administration GUI.
 * @param  {User}  user User model object.
 * @return {Object}       Info object.
 */
async function getAllInfo(  user ) {
  const allStages = await Stage.find({ owner: user._id }).populate("history")
  return allStages
}
/**
 * Returns stage with history with cell indexes
 * @param {Stage} Stage model object
 * @returns {Stage}  Stage 
 */
async function getStageHistoryWithCellIndex(stage) {
  if(stage.history && stage.history.length) {
    for(let i = 0; i < stage.history.length; i++) {
      if(stage.history[i].data.id) {
        let cell = await Cell.findById(stage.history[i].data.id)
        if(cell) {
          stage.history[i].data.index = cell.index
        }
      }
    }
  }
  return stage
}