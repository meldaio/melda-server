const EventEmitter = require("events");
const StageQueue = require("./stage-queue.js");

class StageManagerError extends Error {  }

const STAGES = {};

class StageManager extends EventEmitter {
  /**
   * Creates a new stage or returns it if its already created.
   * @emits  stage-attached
   * @param  {String}     id   Stage id.
   * @param  {Object}     user User object.
   * @return {StageQueue}      Stage object itself.
   */
  getInstance(id, user) {
    if (STAGES[id])
      return STAGES[id];

    const stage = new StageQueue(id, user);
    this.emit("stage-attached", stage);

    return STAGES[id] = stage;
  }
  /**
   * Returns true if a stage is already initialized.
   * @param  {String}  id Stage id
   * @return {Boolean}
   */
  isInitialized(id) {
    return !!STAGES[id];
  }
  /**
   * Returns all of the initialized stages.
   * @return {Object} Stage id indexed stage objects.
   */
  getAllInstances() {
    return STAGES;
  }
  /**
   * Detaches a stage.
   * @param  {String}     id Stage id
   * @return {StageQueue}    StageQueue object
   */
  detachStage(id) {
    if ( ! this.isInitialized(id) ) return;
    const stage = this.getInstance(id);

    if (stage.stayAlive)
      return;
    
    delete STAGES[id];
    this.emit("stage-detached", stage);
    return stage.shutdown();
  }

  keepAlive(id) {
    if ( ! this.isInitialized(id) ) return;
    const stage = this.getInstance(id);
    stage.stayAlive = true;
  }

  stopKeepingAlive(id) {
    if ( ! this.isInitialized(id) ) return;
    const stage = this.getInstance(id);
    stage.stayAlive = false;
  }
}

module.exports = new StageManager;
