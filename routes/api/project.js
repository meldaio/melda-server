const route = require("express").Router();
const RouteError = require("../route-error")
const { User, Cell, Stage, Project } = require("../../models")
const pug = require('pug')
const compiledPreview = pug.compileFile("views/preview-src.pug")
const MeldaUri = require("../../lib/melda-uri")
const { convertStageToRmd } = require("../../lib/utils")
const artifacts = require("../../lib/artifacts")
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const { promisify } = require('util')
const cheerio = require("cheerio")
const _ = require('lodash')
const generator = require("generate-password");

const thumbnailUpload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/projects/',
    filename: function(req, file, cb) {
      cb(null, req.session.user._id + path.extname(file.originalname) + Date.now() + '.png')
    }
  })
})
  
const upload = multer({
  storage: multer.diskStorage({
    filename: (req, file, cb) => cb(null, Date.now() + "")
  }),
  fileFilter: function(req, file, callback) {
    var allowed = [".json", ".ipynb",".rmd",".Rmd"]
    var ext = path.extname(file.originalname)
    if ( ! allowed.includes(ext) ) {
      return callback(new Error("File extension is not allowed"))
    }
    callback(null, true);
  },
  limits: {
    fileSize: process.env.MAX_IMPORT_FILE_SIZE * 1024 ** 2
  }
})

/**
 * Save project function as a middleware callback.
 * All args are passed by express.
 * @param  {Object}   req
 * @param  {Object}   res
 * @param  {Function} next
 * @return {Void}
 */
async function storeProject(req, res, next) {
  if (req.body.title && req.body.title.length > 60) {
    return next(new RouteError(
      "Project title must be at most 60 characters", 
      400
    ))   
  }

  if (req.body.description && req.body.description.length > 250) {
    return next(new RouteError(
      "Project description must be at most 250 characters", 
      400
    ))
  }

  if (req.method === "POST")
  {
    var project = new Project
  }
  else if (req.method === "PUT")
  {
    var uri = (new MeldaUri(req.params)).build("project")
    var project = await Project.findOne({ uri }).populate("owner")

    if ( ! project || ! project.owner ) {
      return next(new RouteError("Project couldn't be found", 404))
    }

    if (project.owner._id.toString() !== req.session.user._id) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (typeof req.body.keywords === "string") {
    req.body.keywords = req.body.keywords
      .split(",")
      .map(v => v.trim())
      .filter(v => !!v)
  }

  project.title = req.body.title || project.title
  project.description = req.body.description || project.description
  project.publication = req.body.publication || project.publication
  project.keywords = req.body.keywords || project.keywords
  project.owner = req.session.user
  project.exclusive = false
  project.public = true
  if(req.body.variables) {
    project.variables = req.body.variables
  }

  if (req.session.user.admin) {
    project.exclusive = !!req.body.exclusive
    
    if (typeof req.body.public === "boolean") {
      project.public = req.body.public
    }
  }

  if (project.exclusive) {
    project.forkable = req.body.forkable
  }

  await project.save()

  res.json(project.export())
}

/**
 * Handles project thumbnail upload.
 */
route.post("/thumbnail/:namespace/:project", thumbnailUpload.single('thumbnail'), async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("project")
  var project = await Project.findOne({ uri }).populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  const unlinkAsync = promisify(fs.unlink)

  // TODO: Make the file path consistent
  const filePath = 'uploads/projects/' + project.thumbnail

  try {
    await unlinkAsync(filePath) 
  } catch (e) {}

  project.thumbnail = req.file.filename
  await project.save()
  
  res.json(project.export())
})

/**
 * Deletes project thumbnail.
 */
route.delete("/thumbnail/:namespace/:project", async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("project")
  var project = await Project.findOne({ uri }).populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if ( ! project.thumbnail ) {
    return next(new RouteError("Thumbnail doesn't exist", 404))
  }

  const unlinkAsync = promisify(fs.unlink)

  // TODO: Make the file path consistent
  const filePath = 'uploads/projects/' + project.thumbnail

  try {
    await unlinkAsync(filePath) 
  } catch (e) {}

  project.thumbnail = null
  await project.save()

  res.json({ success: true })
})


/**
 * Saves a project identified with its uri or creates a new one.
 */
route.post("/", storeProject)
route.put("/:namespace/:project", storeProject)

/**
 * Creates a uri for the given project title
 */
route.get("/create-uri", async (req, res, next) => {
  var uri = await Project.finduri(req.query.title, req.session.user.uri)
  res.json({ uri })
})

/**
 * Forks a project
 */
route.get("/fork/:namespace/:project", async (req, res, next) => {
  try {
    var uri = (new MeldaUri(req.params)).build("project")
    var createdStages = {}
    var query = { uri, public: true }

    if ( ! await isExclusive(req) ) {
      query.exclusive = false
    }

    var project = await Project.findOne(query)

    if ( ! project ) {
      return next(new RouteError("Project couldn't be found", 404))
    }

    var newProject = project.export()

    delete newProject._id
    delete newProject.owner
    delete newProject.uri
    delete newProject.created
    delete newProject.view
    delete newProject.rating
    delete newProject.stages
    delete newProject.exclusive
    delete newProject.totalRating
    delete newProject.allowedUsers
    delete newProject.requestsEnabled
    delete newProject.artifactsMeta
    delete newProject.artifactsRequestId
    delete newProject.artifactsStatus
    delete newProject.artifactsLastUpdate
    delete newProject.modified
    delete newProject.thumbnail
    
    newProject.owner = req.session.user
    newProject.forked = true
    newProject.forkedFrom = project
    newProject.public = true
    newProject.forkCount = 0
    newProject.published = false
    newProject.inProgress = true
    if (newProject.variables) {
      _.map(newProject.variables, (variable) => {
        variable.value = '';
      })
    }

    newProject = await Project.create(newProject)

    var stages = await Stage.find({ project })

    for (let i = 0; i < stages.length; i++) {
      let stage = stages[i]
      let newStage = stage.export()

      delete newStage._id
      delete newStage.uri
      delete newStage.project
      delete newStage.created
      delete newStage.owner

      newStage.project = newProject
      newStage.owner = req.session.user
      newStage.globals = []

      newStage = await Stage.create(newStage)

      var cells = await Cell.find({ stage }).sort("index")

      for (let j = 0; j < cells.length; j++) {
        let cell = cells[j]
        let newCell = cell.export()

        delete newCell._id
        delete newCell.stage
        delete newCell.project
        delete newCell.owner
        delete newCell.created

        newCell.owner = req.session.user
        newCell.stage = newStage
        newCell.project = newProject
        newCell.index = j;

        newCell = await Cell.create(newCell)
      }
    }

    project.forkCount += 1
    await project.save()

    // Added for forking project files
    let output = newProject.export()
    output.oldProjectId = project.id
    res.json(output)
    
  } catch (error) {
    return next(new RouteError("Couldn't be forked, try to refresh page"));
  }
})

route.put("/publish/:namespace/:project", async (req, res, next) => {
  const uri = (new MeldaUri(req.params)).build("project")
  const project = await Project.findOne({ uri }).populate("owner")

  if ( ! project || ! project.owner ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if ( ! req.session.user.admin ) {
    if (project.owner._id.toString() !== req.session.user._id) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }
  
  if ( ! project.public ) {
    return next(new RouteError("Private project can't be published", 403))
  }
  
  project.published = true

  await project.save()

  res.json(project.export())  
})

route.put("/unpublish/:namespace/:project", async (req, res, next) => {
  const uri = (new MeldaUri(req.params)).build("project")
  const project = await Project.findOne({ uri }).populate("owner")

  if ( ! project || ! project.owner ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if ( ! req.session.user.admin ) {
    if (project.owner._id.toString() !== req.session.user._id) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }
  
  if ( ! project.public ) {
    return next(new RouteError("Private project can't be published", 403))
  }

  if ( ! project.published ) {
    return next(new RouteError("Project is already unpublished", 400))
  }
  
  project.published = false

  await project.save()

  res.json(project.export())
})

/**
 * Pure html project content
 */
route.get("/html/:namespace/:project", async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("project")
  var query = { uri }

  if ( ! await isExclusive(req) ) {
    query.exclusive = false
  }

  var project = await Project.findOne({ uri }).populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  project = await project.exportTree()

  var src = compiledPreview({ project })

  const $ = cheerio.load(src)
  $('a').attr('target', '_blank')
  src = $.html()
  
  src = Buffer.from(src).toString("base64")

  if (src.length > process.env.MAX_PROJECT_PREVIEW_SIZE * 1025 ** 2) {
    return next(new RouteError('HTML content is too big', 413))
  }

  res.render("preview", { src })
})

/**
 * Sends project json file to user
 */
route.get("/export/:namespace/:project", async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("project")
  var query = { uri }

  if ( ! await isExclusive(req) ) {
    query.exclusive = false
  }

  var project = await Project.findOne(query)
    .populate("forkedFrom")
    .populate("packages")
    .populate("owner")

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }
  
  var type = req.query.type || "melda"

  if (type === "melda")
  {
    var extension = ".json"
    var json = await project.exportMeldaJSON()
    var content = JSON.stringify(json, null, 2)
  }
  else if (type === "rmd")
  {
    var extension = ".rmd"
    var cells = await Cell.find({ project })
    var content = convertStageToRmd(
      cells.sort((a, b) => a.index - b.index),
      project.title
    )
  }
  else if (type === "ipynb")
  {
    var extension = ".ipynb"
    var cells = await Cell.find({ project })
    var file = convertStageToRmd(
      cells.sort((a, b) => a.index - b.index),
      project.title
    )
    var ipynb = await project.exportRmd(file)
    var content = JSON.stringify(ipynb, null, 2)
  }
  
  var name = project.uri.replace(/^[^/]+\//, "")

  res.json({
    filename: name + extension,
    content
  })
})

route.post("/import", upload.single("file"), async (req, res, next) => {
  var file, json, project, public = true
 
  if (req.session.user.admin && req.body.public !== undefined) {
    public = !!Number(req.body.public)
  }

  file = path.parse(req.file.originalname)

  if (file.ext.match(/rmd$/i)) {
    try {
      content = fs.readFileSync(req.file.path, 'utf8')
      project = await Project.importRmd(content, public, req.session.user, file)
    } catch(err) {
      return next(new RouteError("File format is not supported", err))
    }
  } else {
    json = JSON.parse(fs.readFileSync(req.file.path))
    if (file.ext.match(/json$/i) && json.project && json.project.stages) {
    try {
      project = await Project.importMeldaJSON(json, public, req.session.user)
    } catch(err) {
      return next(new RouteError("File format is not supported", err))
    }    
  } else {
    try {
      project = await Project.importIpynb(json, public, req.session.user, file)
    } catch(err) {
      return next(new RouteError("File format is not supported", err))
    }
  }
  }

  return res.json(project.export())
 })

route.get("/contributors/:namespace/:project", async (req, res, next) => {
  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let uri = (new MeldaUri(req.params)).build("project")
  let query = { uri }

  let project = await Project.findOne({ uri })
    .populate("allowedUsers")
    .populate("joinRequests")
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  let allowedUsers = project.allowedUsers.map(user => user.exportPublic())
  let joinRequests = project.joinRequests.map(user => user.exportPublic())
  let joinRequestsEnabled = project.joinRequestsEnabled

  res.json({ allowedUsers, joinRequests, joinRequestsEnabled })
})

route.put("/allow-user/:namespace/:project", async (req, res, next) => {
  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let uri = (new MeldaUri(req.params)).build("project")
  let query = { uri }

  let project = await Project.findOne({ uri })
    .populate("allowedUsers")
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let allowedUsers = project.allowedUsers || []
  allowedUsers.push(req.body._id)
  project.allowedUsers = allowedUsers
  await project.save()

  res.json({ success: true })
})

route.put("/remove-allowed-user/:namespace/:project", async (req, res, next) => {
  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let uri = (new MeldaUri(req.params)).build("project")
  let query = { uri }

  let project = await Project.findOne({ uri })
    .populate("allowedUsers")
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let allowedUsers = project.allowedUsers || []
  allowedUsers = allowedUsers.filter(user => {
    if (user._id.toString() === req.body._id) {
      return false
    }
    return true
  })
  project.allowedUsers = allowedUsers
  await project.save()
  
  res.json({ success: true })
})

route.put("/accept-join-request/:namespace/:project", async (req, res, next) => {
  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let uri = (new MeldaUri(req.params)).build("project")
  let query = { uri }

  let project = await Project.findOne({ uri })
    .populate("joinRequests")
    .populate("allowedUsers")
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let joinRequests = project.joinRequests || []
  let allowedUsers = project.allowedUsers || []

  let user = joinRequests.find(user => req.body._id === user._id.toString())

  if ( ! user ) {
    return next(new RouteError("User is not available", 404))
  }

  joinRequests = joinRequests
    .filter(_user => _user._id.toString() !== user._id.toString())
  allowedUsers.push(user)

  project.joinRequests = joinRequests
  project.allowedUsers = allowedUsers
  await project.save()

  res.json({ success: true })
})

route.put("/decline-join-request/:namespace/:project", async (req, res, next) => {
  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let uri = (new MeldaUri(req.params)).build("project")
  let query = { uri }

  let project = await Project.findOne({ uri })
    .populate("joinRequests")
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let joinRequests = project.joinRequests || []
  let user = joinRequests.find(user => req.body._id === user._id.toString())

  if ( ! user ) {
    return next(new RouteError("Requested user is not available", 404))
  }

  joinRequests = joinRequests
    .filter(_user => _user._id.toString() !== user._id.toString())

  project.joinRequests = joinRequests
  await project.save()

  res.json({ success: true })
})

route.put("/join-request-status/:namespace/:project", async (req, res, next) => {
  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let uri = (new MeldaUri(req.params)).build("project")
  let query = { uri }

  let project = await Project.findOne({ uri })
    .populate("allowedUsers")
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  project.joinRequestsEnabled = req.body.status
  await project.save()

  res.json({ success: true })
})

route.put("/request-join/:namespace/:project", async (req, res, next) => {
  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let uri = (new MeldaUri(req.params)).build("project")
  let query = { uri }

  let project = await Project.findOne({ uri })
    .populate("joinRequests")
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if ( ! project.joinRequestsEnabled ) {
    return next(new RouteError("Project is not available for contribution", 403))
  }

  let joinRequests = project.joinRequests || []
  let alreadyRequested = false

  joinRequests.forEach(user => {
    if (user._id.toString() === req.body._id) {
      alreadyRequested = true
    }
  })

  if (alreadyRequested) {
    return next(new RouteError("You already requested to join", 403))
  }

  joinRequests.push(req.body._id)
  project.joinRequests = joinRequests
  await project.save()

  res.json({ success: true })
})

route.put("/poe/:namespace/:project", async (req, res, next) => {
  let uri = (new MeldaUri(req.params)).build("project")
  let project = await Project.findOne({ uri })
    .populate("owner")
    .populate("allowedUsers")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  if (req.body.code) {
    let user = await User.findById(req.session.user._id)
    user.artifactsAuthCode = req.body.code
    await user.save()
  }

  project.artifactsMeta = req.body.meta
  await project.save()

  try {
    let result = await artifacts.getToken(req.session.user._id, project.uri, "poeCreation")

    if (result.redirectTo || result.error) {
      return res.json(result)
    }

    if ( ! result.token ) {
      throw new RouteError("Couldn't retrieve token. Please try again.")
    }

    result = await artifacts.createPoe(result.token, project.uri)
    // await artifacts.getStatus(result.token, project.uri)

    res.send(result)
  } catch (e) {
    next(e)
  }
})

route.get("/poe-status/:namespace/:project", async (req, res, next) => {
  let uri = (new MeldaUri(req.params)).build("project")
  let project = await Project.findOne({ uri })
    .populate("owner")
    .populate("allowedUsers")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if ( ! req.session.user.admin ) {
    return next(new RouteError("You don't have access rights", 401))
  }
  
  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  try {
    let result = await artifacts.getToken(req.session.user._id, project.uri, "poeStatus")

    if (result.redirectTo || result.error) {
      return res.json(result)
    }

    if ( ! result.token ) {
      throw new RouteError("Couldn't retrieve token. Please try again.")
    }

    result = await artifacts.getStatus(result.token, project.uri)

    res.json(result)
  } catch(e) {
    next(e)
  }
})

/**
 * Removes a project identified with its name
 * Important: This middleware needs to be registered lastly to avoid route
 * conflicts.
 */
route.delete("/:namespace/:project", async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("project")
  var query = { uri }

  if ( ! await isExclusive(req) ) {
    query.exclusive = false
  }

  var project = await Project.findOne({ uri }).populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  if (await isContributor(req, project.owner) ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  await project.remove()

  res.json({ success: true })
})

/**
 * Generates a api key for the project
 */
 route.get("/generate-api-key/:namespace/:project", async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("project")
  var project = await Project.findOne({ uri })

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }
  project.apiKey = generator.generate({
    length: 16,
    numbers: true,
    strict: true,
    symbols: false,
  });

  await project.save()

  res.json({ success: true, apiKey: project.apiKey })
})
async function isExclusive(req) {
  let user = await User.findById(req.session.user._id);

  if (user) {
    //*
    return user.admin
      || user.type === "patron"
      || Number(user.subscription) > 1
    //*/

    return user.type === "patron"
      || Number(user.subscription) > 1
  }

  return false
}

async function isContributor(req, owner) {
  if (req.session.user._id === owner._id.toString()) {
    return false
  }
  return true
}

///////////////////
// OLD ENDPOINTS //
///////////////////

/**
 * Vote a project identified with its name
 */
route.post("/project/vote", (req, res, next) => {
  Project
    .findOne({
      name: req.body.name,
      public: true,
      // owner: { $ne: req.session.user },
    })
    .then(record => {

      let rating = record.rating;
      const voterIndex = rating.findIndex(vote => vote.userID.toString() === req.session.user._id);

      if (voterIndex > -1) {
        rating.splice(voterIndex, 1);
      }

      rating.push({
        rating: req.body.rating,
        userID: req.session.user._id
      });
      
      record.rating = rating;

      return record.save()
    })
    .then(record => res.json(record))
    .catch(err => next(err))
})

module.exports = route
