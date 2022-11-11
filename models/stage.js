const { mongoose } = require("../lib/mongo");
const { slugify } = require("../lib/utils");
const ObjectId = mongoose.Schema.Types.ObjectId;
const UserError = require("../lib/user-error");
const kernelManager = require("../lib/kernel");

class StageModelError extends UserError {}

const schema = new mongoose.Schema({
  /**
   * Unique uri string.
   * @type {String}
   */
  uri: { type: String, required: true, unique: true },
  /**
   * Stage title/name.
   * @type {String}
   */
  title: { type: String, required: true },
  /**
   * Order in the project.
   * @type {Object}
   */
  order: { type: Number, required: true, default: 0 },
  /**
   * Globals list.
   * @type {Array}
   */
  globals: Array,
  /**
   * Project reference.
   * @type {ObjectId}
   */
  project: { type: ObjectId, ref: "Project" },
  /**
   * Owner reference
   * @type {ObjectId}
   */
  owner: { type: ObjectId, ref: 'User' },
  /**
   * Last modification date.
   * @type {Date}
   */
  modified: { type: Date, required: true },
  /**
   * Creation date.
   * @type {Date}
   */
  created: { type: Date, required: true, default: Date.now },
  /**
   * Packages list.
   * @type {Array}
   */
  packages: [{ name: String, version: String, language: String }],
  /**
   * Date of last successfully finished run.
   * @type {Date}
   */
  lastSuccessfulRun: Date,  
  /**
   * Total cell count for each kernel. Kernel name indexed object.
   * @type {Object}
   */
  cellCounts: {
    /**
     * Total number of R cells.
     * @type {Number}
     */
    R: 0,
    /**
     * Total number of Python cells.
     * @type {Number}
     */
    Python: 0,
    /**
     * Total number of Markdown cells.
     * @type {Number}
     */
    Markdown: 0,
    /**
     * Total number of HTML cells.
     * @type {Number}
     */
    HTML: 0
  },
}, {
  toObject: { virtuals: true },
  toJSON: { virtuals: true }
});
/**
 * Cells reference.
 */
schema.virtual("cells", {
  ref: "Cell",
  localField: "_id",
  foreignField: "stage",
  options: {
    sort: {
      index: 1
    }
  }
});
/**
 * History reference.
 */
schema.virtual("history", {
  ref: "History",
  localField: "_id",
  foreignField: "stage",
});
/**
 * Creates a uri.
 * @param  {Function} next Callback for next hook.
 * @return {Void}
 */
schema.pre("validate", async function(next) {
  // Last modification date
  this.modified = Date.now();

  // Create uri
  var self = this.model("Stage");
  var Project = this.model("Project");
  var Cell = this.model("Cell");
  var project = this.project;

  if ( ! (project instanceof Project) ) {
    project = await Project.findById(project);
  }

  if ( ! project ) {
    console.log(this)
  }

  this.uri = await self.finduri(this.title, project.uri, this._id);

  // Add dependencies
  // var cells = await Cell.find({ stage: this }).populate("packages");

  // this.packages = cells.map(cell => cell.packages);
  // this.packages = [].concat.apply([], this.packages);

  next();
});
/**
 * Clears up cells before removing a stage.
 * @param  {Function} next Callback for next hook.
 * @return {Void}
 */
schema.pre("remove", async function(next) {
  const stage = this._id;
  next(); // remove stage immediately
  await this.model("Cell").deleteMany({ stage });
});
/**
 * Finds a unique uri for a stage.
 * @param  {String}  text    Title of the stage.
 * @param  {Project} project Project model.
 * @param  {String}  id      Stage id.
 * @param  {Number}  number  Try count (for internal usage).
 * @return {String}          Unique uri
 */
schema.statics.finduri = async function(text, project, id, number = 0) {
  if (typeof project === "object") {
    project = project.uri;
  }

  var suffix = number ? "-" + number : "";
  var uri = project + "/" + slugify(text + suffix);
  var query = { uri };

  if (id) {
    query._id = { "$ne": mongoose.Types.ObjectId(id) };
  }

  var record = await this.findOne(query);

  if ( ! record ) {
    return uri;
  }

  return await this.finduri(text, project, id, ++number);
}
/**
 * Exports this stage to a plain object.
 * @return {Object} Plain stage object.
 */
schema.methods.export = function() {
  var record = this.toObject({ versionKey: false, virtuals: true });
  var User = this.model("User");

  if (this.owner instanceof User) {
    record.owner = this.owner.exportPublic();
  }

  return record;
}

/**
 * Async version of this.export().
 * It adds the cells and history virtuals to the object also.
 * @return {Object} Exported stage object.
 */
schema.methods.exportPopulated = async function() {
  await this.populate("cells").populate("history").execPopulate();
  const stage = this.export();
  return stage;
}
/**
 * Adds cells to the stage object and exports it.
 * @return {Object} Plain stage object.
 */
schema.methods.exportTree = async function() {
  var Cell = this.model("Cell");
  var stage = this.export();
  var cells = await Cell.find({ stage: this }).sort("index");

  cells = cells.map(cell => cell.export());
  stage.cells = cells;

  return stage;
}
/**
 * Returns all cells sorted by "index" prop of cell.
 * @return {Array}
 */
schema.methods.getCells = async function() {
  return await this.model("Cell").find({ stage: this }).sort("index");
}
/**
 * Returns the cell given with its id.
 * @return {Cell}
 */
schema.methods.getCell = async function(_id) {
  return await this.model("Cell").findOne({ stage: this, _id });
}
/**
 * Shortcut for loading project model.
 * @return {Project}
 */
schema.methods.getProject = async function() {
  return await this.model("Project").findById(this.project._id || this.project);
}
/**
 * Adds an entry to the history.
 * @param  {Object}  ticket Ticket object. See stage-queue.
 * @return {Promise}        Resolved with entry object
 */
schema.methods.addHistoryEntry = async function(ticket) {
  return await this.model("History").create({
    id: ticket.id,
    name: ticket.name,
    data: ticket.data,
    owner: ticket.user,
    stage: this,
    project: this.project
  });
}
/**
 * Adds an entry to the history.
 * @param  {String} id     Id of the ticket.
 * @param  {String} status started|finished|failed
 * @param  {String} error  Error object if status is "failed"
 * @return {Object}        Resolved with entry object.
 */
schema.methods.updateHistoryEntry = async function(id, status, error) {
  const History = this.model("History");
  const entry = await History.findOne({ id });

  // History entry might be cleaned up while a task continues working.
  // So when task finishes, there won't be an entry to update.
  if ( ! entry ) return;

  entry.status = status;

  if (status === "started")
    entry.startedAt = new Date();
  else if (status === "finished" || status === "failed")
    entry.finishedAt = new Date();

  if (status === "failed" && error)
    entry.error = UserError.wrap(error).export();

  return await entry.save();
}
/**
 * Deletes all history entries.
 * @return {Promise}
 */
schema.methods.clearHistory = async function() {
  await this.model("History").deleteMany({ stage: this });
  return this;
}
/**
 * Creates a cell in this stage.
 * @param  {String} language Language name. See lib/kernel.
 * @param  {Number} index    Index of this cell in the stage.
 * @return {Cell}            Created cell's model.
 */
schema.methods.createCell = async function(language, index) {
  const Cell = this.model("Cell");
  const kernelInfo = kernelManager.all().find(info => info.name === language);

  if ( ! kernelInfo )
    throw new UserError("Kernel not found for " + language);

  if (typeof index !== "number") {
    index = await Cell.countDocuments({ stage: this });
  }

  const cell = await Cell.create({
    language,
    index,
    stage: this,
    project: this.project,
    owner: this.owner,
    isMarkup: kernelInfo.isMarkup
  });

  await Cell.updateMany(
    {
      _id: { $ne: cell._id },
      index: { $gte: cell.index },
      stage: this._id
    },
    { $inc: { index: 1 } }
  );

  await this.updateCellCounts(cell.language);

  return cell;
}
/**
 * Deletes a cell from the stage, updates other cells indexes, updates
 * cellCounts.
 * @param  {String} id Cell id to delete
 * @return {Void}
 */
schema.methods.deleteCell = async function(id) {
  const Cell = this.model("Cell");
  let cell = await Cell.findById(id);
  // Cell might be deleted in a previeous ticket.
  if ( ! cell ) return;

  await this.updateCellCounts(cell.language, -1);

  await Cell.updateMany(
    {
      index: { $gt: cell.index },
      stage: this._id
    },
    { $inc: { index: -1 } }
  );

  return await cell.deleteOne();
}
/**
 * Updates the cell code without evaluating it.
 * @param  {String} id   Cell id
 * @param  {String} code New code.
 * @return {Cell}        Resolves with updated cell model.
 */
schema.methods.updateCellCode = async function(id, code) {
  const Cell = this.model("Cell");
  let cell = await Cell.findById(id);
  // Cell might be deleted in a previeous ticket.
  if ( ! cell ) return;

  // Mark as "not evaluated" if code is changed.
  if (cell.code !== code)
    cell.evaluated = false;

  cell.code = code;

  return await cell.save();
}
/**
 * Updates the cell related fields in project and stage.
 * @param  {String} language Language name. See lib/kernel.
 * @param  {Number} modifier 1: for addition, -1 for subtraction.
 * @return {Void}
 */
schema.methods.updateCellCounts = async function(language, modifier = 1) {
  const project = await this.getProject();

  if (!project.cellCounts) project.cellCounts = {};
  if (!project.cellCounts[language]) project.cellCounts[language] = 0;

  // Update language indexed cell counts.
  project.cellCounts[language] += modifier;
  // Update the used languages in the project.
  const languages = [];
  Object.entries(project.cellCounts).forEach(([ language, count ]) => {
    if (count > 0) languages.push(language);
  });
  project.languages = languages
  await project.save();

  // reload required for this operation:
  // const stage = await this.model("Stage").findById(this._id);
  const stage = this;

  if (!stage.cellCounts) stage.cellCounts = {};
  if (!stage.cellCounts[language]) stage.cellCounts[language] = 0;

  stage.cellCounts[language] += modifier;
  await stage.save();
}
/**
 * Sets the properties of the cell.
 * @param  {String} id    Cell id.
 * @param  {Object} props Properties to set.
 * @return {Cell}
 */
schema.methods.setCellProps = async function(id, props) {
  const cell = await this.model("Cell").findById(id);
  for (let key in props) {
    cell[key] = props[key];
  }
  return cell.save();
}
/**
 * Swaps 2 cell indexes with each other depending on direction.
 * @param  {String} id        Cell id to move up or down.
 * @param  {String} direction up|down
 * @return {Void}
 */
schema.methods.moveCell = async function(id, direction) {
  const Cell = this.model("Cell");
  let modifier = direction === "down" ? 1 : -1;
  let cell1 = await Cell.findById(id);
  // Cell might be deleted in a previous ticket.
  if ( ! cell1 ) return;

  let cell2 = await Cell.findOne({ stage: this, index: cell1.index + modifier });
  // Cell might be the first or the last one and depending on the modifier
  // there might not be a cell2 to swap indexes.
  if ( ! cell2 ) return;

  // swap indexes
  let tmp = cell1.index;
  cell1.index = cell2.index;
  cell2.index = tmp;

  await cell1.save();
  await cell2.save();
}
/**
 * Move a cell to an exact position given with "index" argument.
 * @param  {String} id    Cell id.
 * @param  {Number} index Index to move (starts from 1, not 0).
 * @return {Void}
 */
schema.methods.moveCellTo = async function(id, index) {
  const Cell = this.model("Cell");
  let cell = await Cell.findById(id);
  let cells = await Cell.find({ stage: this }).sort("index");

  // Cell might be deleted in a previeous ticket.
  if ( ! cell ) return;

  id = id.toString();

  // Index of the "cell" in the "cells" array. Not the "cell.index" prop.
  // The difference is "cell.index" starts from 1.
  let currentIndex = null;

  // Find the index of the "cell" inside all cells. We are not using
  // "cell.index" property just in case of that it is not properly assigned
  // before.
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]._id.toString() === id) {
      currentIndex = i;
    }
  }

  if (typeof currentIndex === "number") {
    // Extract the found cell.
    cell = cells.splice(currentIndex, 1)[0];
    // Add it to the desired position.
    cells.splice(index - 1, 0, cell);
  }

  // Update all the changed cell indexes.
  let proms = [];
  for (let i = 1; i <= cells.length; i++) {
    let cell = cells[i - 1];
    if (cell.index !== i) {
      cell.index = i;
      proms.push(cell.save());
    }
  }

  await Promise.all(proms);
}

/**
 * Move a cell to an exact position given with "index" argument.
 * @param  {String} id    Cell id.
 * @param  {Number} index Index to move (starts from 1, not 0).
 * @return {Void}
 */
schema.methods.fetchDependencies = async function() {
  let cells = await this.model("Cell").find({ stage: this });
  return  cells.reduce( (acc, cell) =>  {
    acc = acc.concat( cell.dependencies )
    return acc
  }, [] )
}


const Stage = mongoose.model("Stage", schema)

module.exports = { Stage, schema };