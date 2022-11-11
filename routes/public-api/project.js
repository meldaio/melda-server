const route = require("express").Router();
const {get, defaults, pick, compact, filter, matchesProperty} = require("lodash");
// const GenericError = require("../../lib/generic-error");
const { User, Stage, Cell, Project } = require("../../models");
const Mapper = require("../../lib/mapper");
const apikeys = require("./apikeys");

const paginateDefaults = {"page": 1, "limit": 10};

/* Authentication middleware. See apikeys.json */
route.use((req, res, next) => {
    let key = get(req, "headers.x-api-key");
    if (Object.keys(apikeys).indexOf(key) === -1) {
        // logic error. no need to proceed.
        res.json({
            "code": 401,
            "message": "unauthorized",
            "description": "Please use x-api-key header with your API KEY"
        });
        res.end();
    } else {
        next();
    }
});

/**
 * Returns general stats for melda
 */
route.get("/metrics", async (req, res) => {
    try {
        let metrics = {}
    
        metrics.projects = await Project.countDocuments()
        
        metrics.forkedProjects = await Project.countDocuments({ forked: true })
    
        let usersThatForkedProject = await Project.find({ forked: true }).distinct('owner')
        metrics.usersThatForkedProject = usersThatForkedProject.length
    
        metrics.users = await User.countDocuments()
    
        return res.json(metrics)
      } catch(e) {
        // @Todo: create a global await catch block to convert friendly error messages that integrates into express.js
        res.json({
            "code": 501,
            "error": get(e, "message", "unknown error")
        });
      }
})

/**
 * Returns all public projects
 */
route.get("/projects", async (req, res) => {
    
    let settings = defaults(pick(req.query, ["limit", "page"]), paginateDefaults);

    try {
        // fetch projects
        let projects = await Project.find({"public" : true}).sort("-created").paginate(settings);

        let docIds = compact(projects.results.map(doc => get(doc, "_doc._id"))),
            ownerIds = compact(projects.results.map(doc => get(doc, "_doc.owner"))),
            owners = await User.find({"_id": {"$in": ownerIds}}),
            stages = await Stage.find({"project": {"$in": docIds}});

        projects.results.forEach(projectDoc => {
            // attach owner
            let projectOwner = filter(owners, matchesProperty("_id", projectDoc._doc.owner))[0];
            projectDoc._doc.owner = Mapper.user(projectOwner);
            // attach stages
            let projectStages = filter(stages, matchesProperty("project", projectDoc._doc._id));

            projectDoc._doc.stages = projectStages.map(stageDoc => Mapper.stage(stageDoc));
        });

        projects.results = projects.results.map(doc => Mapper.project(doc));

        res.json(pick(projects, ["results", "current", "count", "last", "limit"]));

    } catch (e) {
        // @Todo: create a global await catch block to convert friendly error messages that integrates into express.js
        res.json({
            "code": 501,
            "error": get(e, "message", "unknown error")
        });
    }
});

/**
 * Returns a specific project with id
 */
route.get("/project/:id", async (req, res) => {

    try {
        // fetch projects
        let project = await Project.findOne({"public" : true, "_id": req.params.id});

        let owner = await User.findOne({"_id": project.owner }),
            stages = await Stage.find({"project": project._id }),
            cells = await Cell.find({"project": project._id});

        project._doc.owner = Mapper.user(owner);

        let projectStages = filter(stages, matchesProperty("project", project._id));

        project._doc.stages = projectStages.map(stageDoc => {
            // attach stage.cells
            let stageCells = filter(cells, matchesProperty("stage", stageDoc._id));
            stageDoc._doc.cells = stageCells.map(cell => Mapper.cell(cell));
            return Mapper.stageWithCells(stageDoc);
        });

        project = Mapper.project(project);

        res.json({project});

    } catch (e) {
        // @Todo: create a global await catch block to convert friendly error messages that integrates into express.js
        res.json({
            "code": 501,
            "error": get(e, "message", "unknown error")
        });
    }
});

module.exports = route;