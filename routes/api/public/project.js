const route = require('express').Router()
const RouteError = require("../../route-error")
const { User, Project, Category, Team, Stage } = require("../../../models")
const MeldaUri = require("../../../lib/melda-uri")
const fs = require('fs');
const childProcess = require('child_process')
const stageManager = require("../../../lib/stage-manager.js");
const stageQueue = require("../../../lib/stage-queue.js");
const _ = require("lodash");

const sortableFields = {
  "fork": "forkCount",
  "-fork": "-forkCount",
  "view": "view",
  "-view": "-view",
  "modified": "modified",
  "-modified": "-modified",
  "rating": "rating",
  "-rating": "-rating"
}

/**
 * Get project thumbnail
 */
route.get("/thumbnail/:namespace/:project", async (req, res, next) => {
  const uri = (new MeldaUri(req.params)).build("project")
  const project = await Project.findOne({ uri }).populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if (project.owner._id.toString() !== req.session.user._id) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  const thumbnail = project.thumbnail
  
  res.json({ thumbnail })
})

/**
 * Searchs a string in projects. Returns last modified 10 project if there is
 * no search parameter in query string.
 */
route.get("/search", async (req, res, next) => {
  var query = {
    public: true,
    forked: false,
    // owner: { $ne: req.session.user }
  }
  var page = Number(req.query.page) || 1
  var listsize = 10
  var sort = req.query.sort || "-modified"

  // if ( ! await isExclusive(req) ) {
  //   query.exclusive = false
  // }

  if ( ! sortableFields[sort] ) {
    sort = "-modified"
  }

  var keywords = []

  if (req.query.keywords) {
    var keywords = req.query.keywords.split(",")
      .filter(keyword => !!keyword)

    if (keywords.length) {
      query.keywords = { $all: keywords }
    }
  }

  var languages = []

  if (req.query.languages) {
    var languages = req.query.languages.split(",")
      .filter(keyword => !!keyword)

    if (languages.length) {
      query.languages = { $all: languages }
    }
  }

  if (req.query.text) {
    query["$or"] = [
      { description: RegExp(req.query.text, "i") },
      { title: RegExp(req.query.text, "i") },
    ]
  }

  if (req.query.author) {
    var users = await User.find({ name: RegExp(req.query.author, "i") })
    query.owner = { $in: users }
  }

  var count = await Project.countDocuments(query)

  var projects = await Project
    .find(query)
    .sort(sortableFields[sort])
    .limit(listsize)
    .skip(listsize * (page - 1))
    .populate("owner")
    .populate("forkedFrom")

  res.json({
    sort,
    page,
    listsize,
    count,
    result: projects.map(project => project.export())
  })
})

/**
 * Get the all the published or some of them if page param is provided 
 */
route.get('/list/publish', async (req, res, next) => {
  let projects = null
  let query = { published: true }
  let keywords = req.query.tags || null
  let sort = req.query.sort || '-modified'
  const page = req.query.page || null
  const limit = 12
  
  if (keywords) {
    keywords = keywords.split(",").filter(keyword => !!keyword)

    if (keywords.length) {
      query.keywords = { $in: keywords }
    }
  }

  if (!page) {
    try {
      projects = await Project.find(query).sort(sort)  
    } catch (e) {
      return next(new RouteError("Projects couldn't be found", 404))
    }
    return res.json(projects)
  }
  
  try {
    projects = await Project
      .find(query)
      .sort(sort)
      .limit(limit)
      .skip((page - 1) * limit)
  } catch (e) {
    return next(new RouteError("Projects couldn't be found", 404))
  }

  return res.json(projects)
})

/**
 * Gets a published project
 */
route.get("/publish/:namespace/:project", async (req, res, next) => {
  const uri = (new MeldaUri(req.params)).build("project")  
  const project = await Project.findOne({ uri }).populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if ( ! project.published ) {
    return next(new RouteError("Project is not published", 403))
  }

  res.json(await project.exportTree())
})


/**
 * Returns the latest modified 5 publishedProjects
 */
route.get("/recentPublished", async (req, res, next) => {
  var query = {
    public: true,
    published: true
  }

  const TOTAL = 10

  // if ( ! await isExclusive(req) ) {
  //   query.exclusive = false
  // }

  var query = Project
    .find(query)
    .sort("-created")
    .limit(TOTAL)

  if (req.query.page) {
    query.skip(req.query.page * TOTAL)
  }

  let records = await query

  res.json(records.map(record => record.export()))
})

/**
 * Returns the latest modified 10 projects
 */
route.get("/recents", async (req, res, next) => {
  var query = {
    public: true,
    forked: false,
    owner: { $ne: req.session.user },
    team: {$eq: null}
  }

  const TOTAL = 10

  // if ( ! await isExclusive(req) ) {
  //   query.exclusive = false
  // }

  var query = Project
    .find(query)
    .sort("-modified")
    .populate("owner")
    .limit(TOTAL)

  if (req.query.page) {
    query.skip(req.query.page * TOTAL)
  }

  let records = await query

  res.json(records.map(record => record.export()))
})

/**
 * Returns last commit
 */
route.get("/commit", async (req, res, next) => {
  var server = []
  var client = []
  var kernelManager = []
  var fileManager = []

  //Get last commit of melda-server
  childProcess.exec('git show --summary --pretty="%H, %an, %cd, %s" --date=short', function(err, stdout) {
    server = stdout.split(",")
  });

  //Get last commit of melda-client
  childProcess.exec('cd melda-client & git show --summary --pretty="%H, %an, %cd, %s" --date=short', function(err, stdout) {
    client = stdout.split(",")
  });

  //Get last commit of melda-kernel-manager
  childProcess.exec('cd melda-kernel-manager & git show --summary --pretty="%H, %an, %cd, %s" --date=short', function(err, stdout) {
    kernelManager = stdout.split(",")
  });

  //Get last commit of melda-file-manager
  childProcess.exec('cd melda-file-manager & git show --summary --pretty="%H, %an, %cd, %s" --date=short', function(err, stdout) {
    fileManager = stdout.split(",")
    res.json({commit: {server: server, client: client, kernelManager: kernelManager, fileManager: fileManager}})
  });
})

/**
 * Returns licenses and notices
 */
route.get("/licenses", async (req, res, next) => {
  let data1 = fs.readFileSync('./LICENSES.txt')
  let data2 = fs.readFileSync('./melda-client/LICENSES.txt')
  let data3 = fs.readFileSync('./melda-kernel-manager/LICENSES.txt')
  let data4 = fs.readFileSync('./melda-file-manager/LICENSES.txt')
  let data = data1+data2+data3+data4;
  res.json({licenses: data})
})

route.get("/notices", async (req, res, next) => {
  let data1 = fs.readFileSync('./notices.txt')
  let data2 = fs.readFileSync('./melda-client/notices.txt')
  let data3 = fs.readFileSync('./melda-kernel-manager/notices.txt')
  let data4 = fs.readFileSync('./melda-file-manager/notices.txt')
  let data = data1+data2+data3+data4;
  res.json({notices: data})       
})

/**
 * Returns all user projects (excluding ones from teams where user is member of)
 */
route.get("/list", async (req, res, next) => {
  var records = await Project
    .find({
      $or: [
        { owner: req.session.user },
        { allowedUsers: req.session.user._id }
      ]
    })
    .sort("-modified")
    .populate("owner")
    .populate("forkedFrom")

  let teams = await Team.find({ members : {$elemMatch: { userId: {$in: req.session.user._id}}}})
  teams = teams.filter(n => n.projects.length !== 0).map(n => n.projects)
  let projectsInTeamsIds = []
  teams.forEach(n => {
    n.forEach(m => {
      projectsInTeamsIds.push(m.toString())
    })
  })

  records = records.map(record => {
    record = record.export()
    if ( record.owner &&
      (record.owner._id.toString() !== req.session.user._id.toString()) ) {
      record.contribution = true
    } else {
      record.contribution = false
    }

    return record
  })

  records = records.filter(n => !projectsInTeamsIds.includes(n._id.toString()))

  res.json(records)
})

/**
 * Returns all team projects
 */
route.get("/list/team", async (req, res, next) => {
  var team = await Team.findOne({uri: { $eq: req.query.uri}})

  if ( !team) {
    return next(new RouteError("Team not found", 404))
  }

  const teamMemberIds = team.members.map(n => n.userId.toString())
  const isMember = teamMemberIds.includes(req.session.user._id.toString())
  if ( !isMember ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  let projects = await Project
    .find({_id: {$in: team.projects}})
    .sort("-modified")
    .populate("owner")
    .populate("team")
    .populate("forkedFrom")

  if ( !projects) {
    return next(new RouteError("Projects not found", 404))
  }

  projects = projects.map(n => {
    n = n.export()
    return n
  })

  res.json(projects)
})

/**
 * Returns all team's projects that is avaliable for user
 */
 route.get("/list/teams-projects", async (req, res, next) => {
  const teams = await Team.find({ members : {$elemMatch: { userId: {$in: req.session.user._id}}}})

  if ( !teams ) {
    return next(new RouteError("Team not found", 404))
  }
  let t = [];
  teams.map(team => {
    t = t.concat(team.projects)
  })
  let projects = await Project
    .find({_id: {$in: t}})
    .sort("-modified")
    .populate("owner")
    .populate("team")
    .populate("forkedFrom")

  if ( !projects) {
    return next(new RouteError("Projects not found", 404))
  }

  projects = projects.map(n => {
    n = n.export()
    return n
  })

  res.json(projects)
})

/**
 * Searchs in tags
 */
route.get("/tags", async (req, res, next) => {
  if ( ! req.query.search ) {
    return res.json([])
  }

  var regex = new RegExp(req.query.search, "i")

  var projectRecords = await Project
    .find({ keywords: { $in: [ regex ] } })
    .sort("-modified")

  // Also search in category tags. Maybe later we can have a tag model.
  var categoryRecords = await Category
    .find({ tags: { $in: [ regex ] } })
    .sort("-modified")
  
  var projectTags = projectRecords.map(record => record.keywords)
  var categoryTags = categoryRecords.map(record => record.tags)

  var tags = [].concat.apply([], projectTags)
  tags = [].concat.apply(tags, categoryTags)
  tags = tags.filter(tag => tag.match(regex))
  tags = tags.filter((tag, index, self) => self.indexOf(tag) === index)
     .slice(0, 10)

  res.json(tags)
})

/**
 * Get All Tags
 */
route.get("/allTags", async (req, res, next) => {

  var categoryRecords = await Category
    .find()
    .sort("-modified")

  categoryRecords = categoryRecords.filter(record => record.tags.length < 2)
  var categoryTags = categoryRecords.map(record => ({
    name: record.tags[0],
    uri: record.slug
  }))

  var tags = [].concat.apply([], categoryTags)
  tags = tags.filter((tag, index, self) => self.indexOf(tag) === index)
     .slice(0, 10)

  res.json(tags)
})

/**
 * Get All Categories
 */
route.get("/allCategories", async (req, res, next) => {

  var categoryRecords = await Category
    .find()
    .sort("-modified")
  
  var categoryNames = categoryRecords.map(record => ({
    name: record.name,
    uri: record.slug,
    tags: record.tags[0],
    parent: record.parent}))
  var names = [].concat.apply([], categoryNames)
  names = names.filter((name, index, self) => self.indexOf(name) === index)
     .slice(0, 10)

  res.json(names)
})

/**
 * Get Project Counts of Categories
 */
route.get("/projectCounts", async (req, res, next) => {

  var categoryRecords = await Category
    .find()
    .sort("-modified")
  
  var categoryTags = categoryRecords.map(record => record.tags)

  var result = []

  for (let i = 0; i < categoryTags.length; i++) {
    let projectsCount = 0;
    for ( let j = 0; j < categoryTags[i].length; j++ ) {
      let keyword = categoryTags[i][j]
      projectsCount += await Project
      .countDocuments({ keywords: keyword });
    }
    result.push(projectsCount)
  }

  res.json(result)
})

/**
 * Gets a project record.
 * Important: This middleware needs to be registered lastly to avoid route
 * conflicts.
 */
route.get("/:namespace/:project/:isEditor", async (req, res, next) => {
  req.session.isEditor = req.params.isEditor === 'true';
  var uri = (new MeldaUri(req.params)).build("project")
  var query = { uri }
  let project;

  // if ( ! await isExclusive(req))
  //   query.exclusive = false;

  try {
    project = await Project
      .findOne(query)
      .populate("owner")
      .populate("forkedFrom");
  } catch(err) {
    return next(new RouteError("Project couldn't be loaded", 500, err));
  }
    
  if ( ! project )
    return next(new RouteError("Project couldn't be found", 404));

  if ( ! Array.isArray(project.allowedUsers) )
    project.allowedUsers = []

  let allowedUsers = project.allowedUsers.map(id => id.toString())

  let editable = false
  if (req.session.user) {
    editable = [ project.owner._id.toString(), ...allowedUsers ]
      .includes(req.session.user._id)
  }

  if ( ! editable ) {
    if ( ! project.public ) {
      return next(new RouteError("You don't have access rights", 401))
    }
  }

  // If its requested by a user other than its owner, increase view counter.
  if (req.session.user) {
    if (req.session.user._id.toString() !== project.owner._id.toString() || true) {
      project.view += 1;
  
      try {
        await project.save();
      } catch(err) {
        return next(new RouteError("Project couldn't be loaded", 500, err));
      }
    }
  }

  project = await project.exportTree()
  project.editable = editable

  if (req.session.user)
    project.contributor = allowedUsers.includes(req.session.user._id)

  res.json(project)
})


route.get("/run", async (req, res, next) => {
  const user = req.session.user;
  const apiKey = req.query.apiKey;
  const stageUri = req.query.uri;

  const project = await Project.findOne({apiKey}).populate('stage').populate('owner')
  req.session.user = project.owner;
  const stages = await Stage.findOne({ project: project._id })
  const stageId =_.find(stages, (stage) => stage.uri === stageUri)._id || stages[0]._id;
  let instance = stageManager.getInstance(stageId, project.owner);
  stageManager.keep

  let model = await instance.getModel();

  let cells = await model.getCells();
  let result = [];
  req.session.user = user;

  try {
    if (project.variables) {
      _.map(project.variables, async (variable) => {
        if (_.includes(Object.keys(req.query), variable.name)) {
          variable.value = req.query[variable.name]
        }
        if (_.includes(_.map(cells, (cell) => cell.language), 'R')) await instance.evalCode('R', `Sys.setenv("${variable.name}" = "${variable.value}")`, project.owner)
        if (_.includes(_.map(cells, (cell) => cell.language), 'Python')) await instance.evalCode('Python', `os.environ["${variable.name}"] = "${variable.value}"`, project.owner)
      })
    }
    for (let i = 0; i < cells.length; i++) {
      let cell = cells[i];
      const { output } = await instance.evalCode(cell.language, cell.code, project.owner);
      result.push(output)
    }
    if (_.includes(_.map(cells, (cell) => cell.language), 'R')) await instance.detachKernel('R', project.owner)
    if (_.includes(_.map(cells, (cell) => cell.language), 'Python')) await instance.detachKernel('Python', project.owner)
  } catch(err) {
    console.log(err)
    result = cells[cells.length - 1].output;
  }
  res.json({ result: _.last(result) })
});

module.exports = route