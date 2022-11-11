const { mongoose } = require("../lib/mongo")
const { slugify } = require("../lib/utils")
const { convertIpynbToStage, convertMeldaJSONtoStage} = require("../lib/utils")
const axios = require("axios")
const ObjectId = mongoose.Schema.Types.ObjectId;
const showdown = require("showdown");
const mdInstance  = new showdown.Converter({ tables: true });
const md = mdInstance.makeHtml.bind(mdInstance);

const doesntModifies = ["forkCount", "view", "rating", "owner"]

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
   * Short description text about this project.
   * @type {String}
   */
  description: { type: String },
  /**
   * Array of keyword strings.
   * @type {Array}
   */
  keywords: [String],
  
  dependencies: [String],
  
  thumbnail: {
    type: String
  },

  preview: { type: String },
  /**
   * Indicates if this project is forked from another one.
   * @type {Boolean}
   */
  forked: { type: Boolean, required: true, default: false },
  /**
   * Where this project is forked from.
   * @type {Object}
   */
  forkedFrom: { type: ObjectId, ref: "Project" },
  /**
   * How many times this project has been forked.
   * @type {Number}
   */
  forkCount: { type: Number, default: 0 },
  /**
   * How many times this project has been viewed.
   * @type {Object}
   */
  view: { type: Number, default: 0 },
  /**
   * Last modification date.
   * @type {Date}
   */
  modified: { type: Date, required: true },
   /**
   * Publication date.
   * @type {Date}
   */
  publication: { type: Date, required: true, default: Date.now},
  /**
   * Creation date.
   * @type {Date}
   */
  created: { type: Date, required: true, default: Date.now },
  /**
   * Owner reference
   * @type {ObjectId}
   */
  owner: { type: ObjectId, ref: 'User', required: true },
  /**
   * Is this project available to anyone.
   * @type {ObjectId}
   */
  public: { type: Boolean, default: true },
  /**
   * Languages used in this project.
   * @type {Array}
   */
  languages: [String],
  /**
   * Ratings given by users.
   * @type {Array}
   */
  rating: [{
    userID: { type: ObjectId, ref: 'User', required: true },
    rating: Number
  }],
  /**
   * Is this project exclusive to paid only users.
   * @type {Object}
   */
  exclusive: { type: Boolean, default: false, required: true },
  /**
   * Is this project forkable.
   * @type {Object}
   */
  forkable: { type: Boolean, default: true, required: true },
  /**
   * Number of cells for each language.
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

  published: { type: Boolean, default: false },
  
  allowedUsers: [{ type: ObjectId, ref: "User", required: false }],

  joinRequests: [{ type: ObjectId, ref: "User", required: false }],

  joinRequestsEnabled: { type: Boolean, default: false },

  artifactsMeta: {
    given_name: "",
    family_name: "",
    middle_name: "",
    suffix: "",
    type: "",
  },

  artifactsRequestId: String,

  artifactsStatus: Object,

  artifactsLastUpdate: Date,

  /**
   * Is this project in Progress like files still forking
   * @type {ObjectId}
   */
  inProgress: { type: Boolean, default: false },
  /**
   * Team reference
   * @type {ObjectId}
   */
  team: { type: ObjectId, ref: 'Team' },

  variables: { type: Array, required: false },
  apiKey: { type: String, required: false },
}, {
  toObject: {
    virtuals: true
  },
  toJSON: {
    virtuals: true
  }
})

schema.pre("validate", async function(next) {
  var self = this.model("Project")
  var User = this.model("User")
  var owner = this.owner

  if ( ! (owner instanceof User) ) {
    owner = await User.findById(owner)
  }
  
  this.uri = await self.finduri(this.title, owner.uri, this._id)

  if (this.isNew) {
    this.modified = Date.now()
  }
  
  if (!this.exclusive && !this.forkable) {
    throw new Error('Project must be exclusive in order to be not forkable')
  }
  next()
})

schema.pre("save", async function(next) {
  this.changedPaths = this.modifiedPaths()
  var changed = this.changedPaths
    .filter(field => !doesntModifies.includes(field))

  if (changed.length) {
    this.modified = Date.now()
  }

  if ( this.isNew && ! this.forked ) {
    let initialCellContent

    try {
      let { data } = await axios.get(process.env.INITIAL_CELL_GIST_URL)
      for (let fileName in data.files) {
        initialCellContent = data.files[fileName].content
        break
      }
    } catch(e) {}

    let initialStage = await this.model("Stage").create({
      title: this.title,
      owner: this.owner,
      packages: [],
      project: this,
    })

    if (initialCellContent) {
      let output = [{ data: { "text/html": md(initialCellContent) } }]

      await this.model("Cell").create({
        stage: initialStage,
        project: this,
        language: "Markdown",
        code: initialCellContent,
        output,
        owner: this.owner,
        index: 0,
        packages: [],
        hiddenCode: true,
        hiddenOutput: false,
        isMarkup: true,
      })
    }
  }

  next()
})

schema.post("save", async function() {
  if (this.changedPaths.includes("uri")) {
    var stages = await this.model("Stage").find({ project: this })

    for (let i = 0; i < stages.length; i++) {
      await stages[i].save()
    }
  }
})

schema.pre("remove", async function(next) {
  const project = this._id;
  next(); // remove project immediately
  await this.model("Stage").deleteMany({ project })
})

schema.methods.export = function() {
  var record = this.toJSON({ versionKey: false })
  var User = this.model("User")
  var Project = this.model("Project")
  
  if (this.owner instanceof User) {
    record.owner = this.owner.exportPublic()
  }

  if (this.forkedFrom instanceof Project) {
    record.forkedFrom = this.forkedFrom.export()
  }

  delete record.cellCounts

  if ( ! record.exclusive ) {
    delete record.exclusive
  }

  if (Array.isArray(record.rating)) {
    record.totalRating = record.rating
      .reduce((acc, curr) => acc + curr.rating, 0)
  }

  return record
}

schema.methods.exportTree = async function(stageId = "all") {
  var Stage = this.model("Stage");
  var project = this.export();
  var stages = await Stage.find({ project }).sort("order");

  if (stageId === "all") {
    stages = await Promise.all(stages.map((stage, indx) => {
      return stage.exportTree();
    }));
  } else {
    stages = await Promise.all(stages.map(stage => {
      if (stageId === stage._id.toString()) {
        return stage.exportTree();
      } else {
        return stage.export();
      }
    }));
  }

  project.stages = stages.sort((i, j) => i.order > j.order ? 1 : -1);

  return project;
}

schema.methods.exportRmd = async function(obj) {
  const res = await axios.post(`${process.env.RMD_CONVERTER_URL}/convert`,
  {
    file: obj,
    format: "rmd"
  })
  project = res.data

  return project
}
schema.methods.exportMeldaJSON = async function() {
  var project = await this.exportTree()

  project.rating = project.totalRating

  if (project.forkedFrom && project.forkedFrom.uri) {
    project.forkedFrom = project.forkedFrom.uri
  } else {
    project.forkedFrom = null
  }

  delete project._id
  delete project.totalRating
  delete project.owner
  delete project.cellCounts
  delete project.public
  delete project.exclusive
  delete project.forkable
  delete project.published
  delete project.allowedUsers
  delete project.requestsEnabled
  delete project.artifactsMeta
  delete project.artifactsRequestId
  delete project.artifactsStatus
  delete project.artifactsLastUpdate
  delete project.view
  delete project.modified
  delete project.publication

  project.stages.forEach(stage => {
    delete stage._id
    delete stage.owner
    delete stage.project
    delete stage.cellCounts

    if(stage.cells) {
      stage.cells.forEach(cell => {
        delete cell._id
        delete cell.owner
        delete cell.stage
        delete cell.project
      })
    }
  })

  var name = project.uri.replace(/^[^/]+\//, "")

  return {
    version: process.env.VERSION,
    name,
    project
  }
}

schema.statics.finduri = async function(text, user, id, number = 0) {
  if (typeof user === "object") {
    user = user.uri
  }

  var suffix = number ? "-" + number : ""
  var uri = user + "/" + slugify(text + suffix)
  var query = { uri }

  if (id) {
    query._id = { "$ne": mongoose.Types.ObjectId(id) }
  }

  var record = await this.findOne(query)

  if ( ! record ) {
    return uri
  }

  return await this.finduri(text, user, id, ++number)
}

schema.statics.importMeldaJSON = async function(obj, public, user) {
  var Project = this.model("Project")
  var Stage = this.model("Stage")
  var Cell = this.model("Cell")

  var project = obj.project
  var stages = project.stages

  delete project.stages

  if (project.forkedFrom) {
    var forkedFrom = await Project.findOne({
      uri: project.forkedFrom
    })

    if (forkedFrom) {
      project.forkedFrom = forkedFrom
      project.forked = true
    } else {
      project.forkedFrom = null
      project.forked = false
    }
  }

  project = new Project(project)
  project.owner = user
  project.public = public
  project.rating = []
  project = await project.save()

  // Remove the default created stage
  await Stage.deleteOne({ project })

  for (let i = 0; i < stages.length; i++) {
    let stage = stages[i]
    let cells = stage.cells

    delete stage.cells

    stage = new Stage(stage)
    stage.project = project
    stage.owner = user
    stage.globals = []
    stage = await stage.save()

    for (let j = 0; j < cells.length; j++) {
      let cell = cells[j]

      cell = new Cell(cell)
      cell.stage = stage
      cell.project = project
      cell.owner = user
      cell = await cell.save()
    }
  }

  return project
}
schema.statics.importRmd = async function(obj, public, user, file) {
  var Project = this.model("Project")
  title = file.name.substring(0, 55);
  const res = await axios.post(`${process.env.RMD_CONVERTER_URL}/convert`, 
  {
    file: obj,
  })
  project = await Project.importMeldaJSON(res.data, public, user)

  return project
}

schema.statics.importIpynb = async function(obj, public, owner, file) {
  var Project = this.model("Project")
  var Stage = this.model("Stage")
  var Cell = this.model("Cell")
  
  title = file.name.substring(0, 55);

  var project = new Project({ title, owner, public })
  var cells = convertIpynbToStage(obj)

  project = await project.save()
  stage = await Stage.findOne({ project })

  // Remove the default created cell
  await Cell.deleteOne({ stage })

  for (let i = 0; i < cells.length; i++) {
    let cell = new Cell({
      project,
      stage,
      owner,
      ...cells[i]
    })

    await cell.save()
  }

  return project
}

const Project = mongoose.model("Project", schema)

module.exports = { Project, schema }