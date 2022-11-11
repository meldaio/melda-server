const route = require("express").Router()
const multer = require("multer")
const request = require("request")
const axios = require("axios")
const fs = require("fs")
const kue = require("kue")
const EventEmitter = require("events");
const { Project } = require("../../models")


const uploadMiddleware = multer({ dest: "uploads/" })
const fileManagerUrl = process.env.AWS_EFS_FILE_MANAGER_HOST.trim('/')+'/'
const emitter = new EventEmitter();


const queue = kue.createQueue({
  disableSearch: false,
  redis: {
    port: process.env.REDIS_PORT,
    host: process.env.REDIS_HOST
  }
})


queue.setMaxListeners(Infinity)

module.exports = route

route.post("/mkdir/:project", async (req, res, next) => {
  const { project } = req.params;
  const { path } = req.body;
  try {
    const { data } = await axios.post(fileManagerUrl + "mkdir/" + project, { path });
    return res.json(data);
  } catch(error) {
    return next(error);
  }
})


route.post("/copy/:project/:newProject", async (req, res, next) => {
  const { project, newProject } = req.params;
  const { path } = req.body;
  try {
    const { data } = await axios.post(fileManagerUrl + "copy/" + project + '/' + newProject, { path });
    return res.json(data);
  } catch(error) {
    return next(error);
  }
})

route.post("/move/:project/:newProject", async (req, res, next) => {
  const { project, newProject } = req.params;
  const { path } = req.body;
  try {
    const { data } = await axios.post(fileManagerUrl + "move/" + project + '/' + newProject, { path });
    return res.json(data);
  } catch(error) {
    return next(error);
  }
})

route.get("/list/:project", async (req, res, next) => {
  let path = req.query.path || "";
  try {
    const { data } = await axios
      .get(fileManagerUrl + "list/" + req.params.project + "?path=" + path)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

route.get("/upload-url/:project", async (req, res, next) => {
  let { data } = await axios.get(
    fileManagerUrl + "upload-url/" + req.params.project,
    { params: req.query }
  )
  res.json(data)
})

route.get("/download-url/:project", async (req, res, next) => {
  let { data } =  await axios.get(
    fileManagerUrl + "download-url/" + req.params.project,
    { params: req.query }
  )
  res.json(data)
})

// Copy (Fork) Old Project Files to new Project Folder
route.post("/fork/:oldProjectId/:newProjectId", async (req, res, next) => {
  const { oldProjectId, newProjectId } = req.params;

  const forkJob = queue.create("start fork file", {
    newProject: newProjectId,
    project: oldProjectId
  })
  let rejected = false;

  forkJob.save()
  forkJob.on("failed", async error => {
    !rejected && emitter.emit("fork-file-failed", {oldProjectId, newProjectId});
    rejected = true;

    try {
      let project = await Project.findById(newProjectId)
      project.inProgress = false
      project.save()
    } catch(e) {
      console.error(e)
    }
  });
  forkJob.on("complete", async data => {
    if (rejected) return false;

    try {
      let project = await Project.findById(newProjectId)
      project.inProgress = false
      await project.save()
    } catch(e) {
      console.error(e)
    }
  });

  res.json({status: 'Process staterted'});
})

route.post("/:project", async (req, res, next) => {
  const { project } = req.params;
  try {
    const { data } = await axios.post(fileManagerUrl + project);
    return res.json(data);
  } catch(error) {
    return next(error);
  }
})

route.get("/:file", async (req, res, next) => {
  var fsId = await getFs(req.session.user.email)
  var name = encodeURIComponent(req.params.file)
  var req2 = request.get(fileManagerUrl + fsId + "/" + name)

  // res.on("drain", () => res.resume())
  req2.on("end", () => res.end())
  res.on("error", (error) => next(error))
  req2.pipe(res)
})

route.delete("/:project", async (req, res, next) => {
  const { project } = req.params;
  try {
    const { data } = await axios.delete(
      fileManagerUrl + project,
      { params: req.query }
    );

    res.json(data)
  } catch (error) {
    next(error)
  }
})




async function getFs(email) {
  if ( ! efs ) {
    return Promise.resolve(false)
  }

  return efs.get(email).then(obj => {
    if (obj.fsId)
      return obj.fsId
    if (obj.creation)
      return obj.creation
  })
}