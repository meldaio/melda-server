const route = require("express").Router()
const { Cell, Stage, Project } = require("../../models");
const RouteError = require("../route-error")
const MeldaUri = require("../../lib/melda-uri")

module.exports = route

route.get("/list/:namespace/:project/:stage", async (req, res, next) => {
  var uri = (new MeldaUri(req.params))

  var project = await Project
    .findOne({ uri: uri.build("project") })
    .populate("owner")

  if ( ! project ) {
    return next(new RouteError("Project couldn't be found", 404))
  }

  if ( ! project.public && project.owner._id.toString() !== req.user._id ) {
    return next(new RouteError("You don't have access rights", 401))
  }

  var stage = await Stage.findOne({ uri: uri.build("stage") })
  var cells = await Cell.find({ stage }).sort("index")
  
  cells = cells.map(cell => cell.export())

  res.json(cells)
})

route.get("/cell-html/:id", (req, res) => {
	res.set('Content-Type', 'text/html')

	Cell.findById(req.params.id)
		.then(record => res.send(record.output[0].data["text/html"]))
		.catch(err => res.send("<html><body><h3>Error on html output</h3></body></html>"))
})




/* REMOVE ORPHAN CELLS AND STAGES
;(async ()=>{
  console.log("started")

  let cells = await Cell
    .find()
    .populate("project")
    .populate("stage")

  let proms = []
  let orphans = 0
  let currentProjects = {}

  for (let i = 0; i < cells.length; i++) {
    if ( ! cells[i].project || ! cells[i].stage) {
      orphans++
      //proms.push(cells[i].remove())
    } else {
      currentProjects[cells[i].project.uri] = 1
    }
  }



  let oprhanStages = 0
  let stageProms = []

  let stages = await Stage
    .find()
    .populate("project")

  for (let i = 0; i < stages.length; i++) {
    if ( ! stages[i].project ) {
      oprhanStages++
      //stageProms.push(stages[i].remove())
    }
  }

  await Promise.all(proms)
  await Promise.all(stageProms)

  console.log("Total projects:", Object.keys(currentProjects).length)
  console.log("Total cells to remove:", orphans)
  console.log("Total stages to remove:", oprhanStages)
  console.log("finished")
})()
// */