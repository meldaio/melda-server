const { mongoose } = require("../lib/mongo");
const ObjectId = mongoose.Schema.Types.ObjectId;
const UserError = require("../lib/user-error");

class HistoryModelError extends UserError {}

const schema = new mongoose.Schema({
  /**
   * Stage reference.
   * @type {ObjectId}
   */
  stage: { type: ObjectId, ref: "Stage" },
  /**
   * Project reference.
   * @type {ObjectId}
   */
  project: { type: ObjectId, ref: "Project" },
  /**
   * Issued by.
   * @type {ObjectId}
   */
  owner: { type: ObjectId, ref: 'User' },
  /**
   * UUID of ticket in the queue.
   * @type {String}
   */
  id: String,
  /**
   * Issue date.
   * @type {Date}
   */
  queuedAt: { type: Date, default: Date.now },
  /**
   * Issue date.
   * @type {Date}
   */
  startedAt: Date,
  /**
   * Finished date.
   * @type {Date}
   */
  finishedAt: Date,
  /**
   * Status of this ticket.
   * @type {Object}
   */
  status: {
    type: String,
    enum: ["queued", "started", "finished", "stopped", "failed"],
    default: "queued"
  },
  /**
   * Exported error object if status is "failed".
   * @type {Object}
   */
  error: Object,
  /**
   * Method name
   * @type {String}
   */
  name: String,
  /**
   * Input arguments of the method.
   * @type {Object}
   */
  data: Object,
});

const History = mongoose.model("History", schema);

module.exports = { History, schema };

