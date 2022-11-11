const { mongoose } = require("../lib/mongo")
const aceBuilder = require("../lib/ace-builder")

const cellSchema = new mongoose.Schema({
  title: {
    type: String,
    required: false,
  },

  index: {
    type: Number,
    required: false,
  },

  hiddenCode: {
    type: Boolean,
    required: true,
    default: false,
  },

  hiddenOutput: {
    type: Boolean,
    required: true,
    default: false,
  },

  dontEvaluate: {
    type: Boolean,
    required: true,
    default: false
  },

  language: {
    type: String,
    required: false,
  },

  code: {
    type: String,
  },

  ace: {
    type: Object
  },

  evaluated: {
    type: Boolean,
    required: true,
    default: false,
  },

  output: {
    type: Array,
    required: false,
  },

  error: {
    type: Array,
    required: false,
  },

  stderr: {
    type: Array,
    required: false
  },

  stage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Stage",
    required: true
  },

  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Project",
    required: true
  },

  modified: {
    type: Date,
    required: true,
    default: Date.now,
  },

  created: {
    type: Date,
    required: true,
    default: Date.now,
  },

  packages: [{
    name: String,
    language: String,
    version: String
  }],

  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  isMarkup: {
    type: Boolean,
    required: true,
    default: false,
  },
  
  dependencies: [{
    package: String,
    method: String
  }]
})

cellSchema.pre("validate", async function(next) {
  this.modified = Date.now();
  this.ace = aceBuilder(this.code || "");
  next();
})

cellSchema.post("init", function(record) {
  if (record.ace === undefined || record.ace.html === undefined) {
    record.ace = aceBuilder(record.code || "")
  }
})

/*
cellSchema.pre("save", async function(next) {
  var Project = this.model("Project")

  if ( ! (cell.project instanceof Project) ) {
    cell.project = await Project.findById(cell.project)
  }

  cell.project.modified = Date.now()
  await cell.project.save()

  next()
})
*/

cellSchema.methods.export = function() {
  var record = this.toJSON({ versionKey: false })
  return record
}

const CellCollection = mongoose.model("Cell", cellSchema)

module.exports = { Cell: CellCollection, schema: cellSchema }