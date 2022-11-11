"use strict";

const route = require("express").Router();
const RouteError = require("../route-error")
const pug = require('pug')
const { Stage, Project, Cell, User } = require("../../models");
const { convertIpynbToStage, convertMeldaJSONtoStage, convertStageToRmd, convertRmdtoStage,slugify, uniqueName } = require("../../lib/utils");
const path = require("path");
const multer = require("multer");
const fs = require("fs")
const MeldaUri = require("../../lib/melda-uri")
const stageManager = require("../../lib/stage-manager.js");

const DebugTimer = require('debugging-timer');
const timer = new DebugTimer();


const compiledPreview = pug.compileFile("views/preview-src.pug")

class StageError extends RouteError {  }

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads/");
  },
  filename: function (req, file, cb) {
    var datetimestamp = Date.now();
    var ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + datetimestamp + ext);
  }
});

var upload = multer({
  storage,
  fileFilter: function (req, file, callback) {
    var allowed = [".json", ".ipynb", ".rmd", ".Rmd"]
    var ext = path.extname(file.originalname);
    if ( ! allowed.includes(ext) ) {
      return callback(new Error("File extension is not allowed"));
    }
    callback(null, true);
  },
  limits: {
    fileSize: 10 * 1024 ** 2
  }
})

/**
 * This endpoint is to get the ID of the stage and required for socket
 * connection (we require id of the stage to connect to the stage socket).
 */
route.get("/id/:namespace/:project/:stage", async (req, res, next) => {
  let uri = (new MeldaUri(req.params)).build("stage");
  if ( ! uri ) {
    return next(new RouteError("Invalid stage uri"));
  }

  let stage = await Stage.findOne({ uri });

  if ( ! stage || ! stage._id) {
    return next(new RouteError("Stage not found", 404))
  }

  res.json({ _id: stage._id })
});


route.put("/run/:namespace/:project/:stage", async (req, res, next) => {
  try {
    timer.start("Loading stage");
    let uri = (new MeldaUri(req.params)).build("stage");
    let model = await Stage.findOne({ uri });

    if ( ! model || ! uri ) {
      throw new StageError("Stage not found", 404);
    }

    let id = model._id.toString();
    let instance = stageManager.getInstance(id, req.session.user);
    stageManager.keepAlive(id);

    await model.clearHistory();

    let cells = await model.getCells();
    let { input, inputCell } = req.body;
    timer.end("Loading stage");

    if (typeof input !== "object") {
      throw new StageError("Input has to be in JSON format", 400)
    }

    inputCell = inputCell ? Number(inputCell) : 0;

    timer.start("Evaluating cells");

    for (let i = 0; i < cells.length; i++) {
      timer.start("Run cell " + i);
      let cell = cells[i];
      let cellId = cell._id.toString();
      let code = cell.code;

      if (input && i === inputCell) {
        code = "input='" + JSON.stringify(input) + "'";
      }

      await instance.evalCell(cellId, cell.language, code, req.session.user);
      timer.end("Run cell " + i);
    }

    timer.end("Evaluating cells");

    timer.start("Collecting output");

    // Refresh models
    model = await instance.getModel();
    cells = await model.getCells();

    let lastCell = cells[cells.length - 1];
    let output = null;
    let errors = [];

    // Collect errors
    for (let i = 0; i < cells.length; i++) {
      let error = { cell: i, error: null, stderr: null };

      if (cells[i].error.length)
        error.error = cells[i].error;
      if (cells[i].stderr.length) 
        error.stderr = cells[i].stderr;

      if (error.error || error.stderr)
        errors.push(error);
    }

    try {
      let out = lastCell.output.find(item => item.name === "stdout");
      
      if (out) {
        output = out.text;
        output = JSON.parse(output);
      }
    } catch(err) {}

    timer.end("Collecting output");
    timer.print();

    res.json({ output, errors })
  } catch (error) {
    next(error);
  }
});

/**
 * Creates a stage with the given title.
 */
route.post("/:namespace/:project", async (req, res, next) => {
  if (req.body.title.length > 60) {
    return next(new RouteError(
      "Stage title must be at most 60 characters", 
      400
    ))   
  }

  var uri = (new MeldaUri(req.params)).build("project");

  var lastStage = await Stage
    .findOne({
      uri: new RegExp("^" + uri + "/[^/]+"),
      owner: req.session.user
    })
    .sort("-order")
    .limit(1)
    .populate("project");

  if ( ! lastStage ) {
    return next(new RouteError(
      "Project couldn't be found or you don't have access rights",
      404
    ));
  }

  var project = lastStage.project;
  var order = lastStage.order + 1;

  var stage = await Stage.create({
    title: req.body.title || "Untitled Stage",
    owner: req.session.user,
    project,
    order,
  })

  res.json(stage.export())
})

route.post("/:namespace/:project/:stage", async (req, res, next) => {
  if (req.body.title.length > 60) {
    return next(new RouteError(
      "Stage title must be at most 60 characters", 
      400
    ))   
  }
  
  var uri = (new MeldaUri(req.params)).build("stage")
  var stage = await Stage.findOne({ uri, owner: req.session.user })

  if ( ! stage ) {
    return next(new RouteError(
      "Project couldn't be found or you don't have access rights",
      404
    ))
  }

  stage.title = req.body.title
  await stage.save()

  res.json(stage.export())
})

/**
 * Removes the stage.
 */
route.delete("/:namespace/:project/:stage", async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("stage")
  var stage = await Stage
    .findOne({
      uri,
      owner: req.session.user
    })
    .populate("project")

  if ( ! stage ) {
    return next(new RouteError(
      "Stage couldn't be found or you don't have rights",
      404
    ))
  }

  await Stage.updateMany({
    order: { $gt: stage.order },
    project: stage.project
  }, {
    $inc: { order: -1 }
  })

  await Cell.remove({ stage })
  await stage.remove()

  res.json({
    error: false,
    message: "Stage removed"
  })
});

/**
 * Updates the stage's order property and sorts other stages accordingly.
 */
route.post("/:namespace/:project/:stage/sort", async (req, res, next) => {
  var uri = (new MeldaUri(req.params)).build("stage")
  var stage = await Stage.findOne({ uri, owner: req.session.user })
  var newOrder = Number(req.body.order)

  if ( ! stage ) {
    return next(new RouteError(
      "Stage couldn't be found or you don't have rights",
      404
    ))
  }

  var currentOrder = stage.order

  if (newOrder > currentOrder) {
    await Stage.updateMany({
      order: { $lte: newOrder, $gt: currentOrder },
      project: stage.project
    }, {
      $inc: { order: -1 }
    })
  } else {
    await Stage.updateMany({
      order: { $lt: currentOrder, $gte: newOrder },
      project: stage.project
    }, {
      $inc: { order: 1 }
    })
  }

  stage.order = newOrder
  await stage.save()

  return res.json({
    error: false,
    message: "Stage order has updated successfully!"
  })
});

/**
 * Extracts stage titles from JSON files.
 */
route.put("/:namespace/:project/title/infos", upload.single("file"), async (req, res) => {
  let json= req.session.user
  var allStages = []
  var stageName = ''
  json = JSON.parse(fs.readFileSync(req.file.path))
 
  var tempProject = json.project
  var stages = tempProject.stages
  for ( let i = 0; i < Object.keys(stages).length; i++ ) {
    let stage = stages[i]
    stageName = stage.title
    allStages.push(stageName)
  }
  
  res.json({
    title: allStages
  })
});

/**
 * Creates a stage with the given ipynb file.
 */
route.post("/:namespace/:project/import/ipynb", upload.single("file"), async (req, res, next) => {
  let fileName, json, file, cells, stageName, owner= req.session.user
  const uri = (new MeldaUri(req.params)).build("project");

  const lastStage = await Stage
    .findOne({
      uri: new RegExp("^" + uri + "/[^/]+"),
      owner
    })
    .sort("-order")
    .limit(1)
    .populate("project");

  if ( ! lastStage ) {
    return next(new RouteError(
      "Project couldn't be found or you don't have access rights",
      404
    ));
  }

  try {
    fileName = path.parse(req.file.originalname)
  } catch (err) {
    return next(new RouteError("File format is not supported", err))
  }

  if ( fileName.ext.match(/ipynb$/) ) {
    json = JSON.parse(fs.readFileSync(req.file.path))
    cells = convertIpynbToStage(json)
    stageName = fileName.name.substring(0, 55)
  } 
  else if ( fileName.ext.match(/rmd$/i)) {
    file = fs.readFileSync(req.file.path, 'utf8')
    json = await convertRmdtoStage(file)
    cells= convertMeldaJSONtoStage(json, 0)
    stageName = fileName.name.substring(0, 55)
  } 
  else if ( fileName.ext.match(/json$/) ) {
    json = JSON.parse(fs.readFileSync(req.file.path))

    if (req.body.stages == 'true') {
    cells = convertMeldaJSONtoStage(json,0)
    stageName = fileName.name.substring(0, 55)
    } else {
      var selectedStages = req.body.stages.split(",");
      for (let i = 0; i < selectedStages.length; i++) {
        let stage = selectedStages[i]
        if(stage == 'true'){
          stage = convertMeldaJSONtoStage(json,i)
          cells = stage.cells
          stageName = stage.name
        }
      }
    }
  } 
  else {
    return next(new RouteError("File format is not supported", err))
  }

  const project = lastStage.project;
  const order = lastStage.order + 1;

  const stage = await Stage.create({
    title: stageName || "Untitled Stage",
    owner: req.session.user,
    project,
    order,
  })

  for (let i = 0; i < cells.length; i++) {
    let cell = new Cell({
      project,
      stage,
      owner,
      ...cells[i]
    })

    await cell.save()
  }
  
  res.json(stage.export())
})






















route.get([
  "/preview-src/:project/:stage",
  "/preview/:project/:stage"
], (req, res, next) => {
  Stage.findOne({ name: req.params.stage })
    .populate("project")
    .then(stage => {
      if (stage.project.name !== req.params.project) {
        throw new Error("Stage not found");
      }

      return Cell.find({ stage })
        .then(cells =>
          Promise.resolve({
            cells,
            stage
          })
        );

      stage = stage.toObject();
    })
    .then(({
      cells,
      stage
    }) => {
      var project = stage.project;

      project.stages = [stage];
      stage.cells = cells.sort((a, b) => a.index - b.index);

      var src = compiledPreview({ project })
      src = Buffer.from(src).toString("base64")
      
      res.render("preview", { src })
    });
});

route.post("/import", upload.single("userFile"), (req, res, next) => {
  var file, json, result = {}

  try {
    file = path.join(process.cwd(), req.file.path)
    json = JSON.parse(fs.readFileSync(file));

  } catch (err) {
    return next(new Error("File format is not supported"));
  }

  if (file.match(/\.json$/) && json.stage && json.version) {
    if (json.version !== process.env.VERSION) {
      return next(new Error("Imported file is an old version. Current version"
        + " is " + process.env.VERSION))
    }

    result = json.stage
  } else {
    try {
      result.cells = convertIpynbToStage(json);
    } catch(err) {
      return next(new Error("File format is not supported"));
    }
  }

  return Project
    .findOne({
      name: req.body.project,
      owner: req.session.user,
    })
    .then(project => {
      if ( ! project ) {
        throw new RouteError(
          "Project couldn't be found or you don't have access rights",
          404
        )
      }

      return Stage
        .findOne({ project })
        .sort({ order: -1 })
        .then(stage => {
          var order = stage && Number.isInteger(stage.order)
            ? stage.order + 1
            : 1

          return Stage
            .create({
              title: result.title || "Untitled",
              globals: result.globals || [],
              packages: result.packages || [],
              order,
              owner: req.session.user,
              project
            })
        })
    })
    .then(stage => {
      var proms = result.cells.map(cell => {
        cell.stage = stage
        cell.owner = req.session.user
        cell.project = stage.project

        return Cell.create(cell)
      })

      return Promise.all(proms)
        .then(messages => stage)
    })
    .then(stage => {
      res.json({
        message: "File imported successfully",
        redirect: {
          stage: stage.name,
          project: stage.project.name
        }
      })
    })
    .catch(err => next(err));
});

route.get("/export/:project/:stage", (req, res, next) => {
  var type = req.query.type || "melda"

  return Stage
    .findOne({ name: req.params.stage })
    .then(stage => {
      var file = stage.name + ".json"
      var content

      if (type === "rmd") {
        return Cell
          .find({ stage })
          .then(cells => {
            content = convertStageToRmd(
              cells.sort((a, b) => a.index - b.index),
              stage.title
            )

            file = stage.name + ".Rmd"

            return { file, content }
          })
      }

      return stage
        .exportToMeldaJSON()
        .then(stage => {
          return { content: JSON.stringify(stage, null, 2), file }
        })
    })
    .then(({ file, content }) => {
      res.writeHead(200, {
        "Content-Type": "application/force-download",
        "Content-disposition": "attachment; filename=" + file
      });

      res.end(content);
    })
    .catch(err => next(err));
});

module.exports = route;