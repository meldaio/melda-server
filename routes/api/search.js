const route = require("express").Router();
const _ = require("lodash");
const request     = require("request");
const qs = require('querystring');
const { Project } = require("../../models");

const PAGINATION = 25;
const API        = process.env.RCULTURE_SERVER + "api/";
const SERVER     = process.env.RCULTURE_SERVER;

/**
 * Search projects
 * Querystring parameters:
 *   text: search string
 */
route.get("/search", (req, res, next) => {
  const projectSearch = new Promise(function(resolve) {
    Project
      .find({
        public: true,
        forkedFrom: null,
        $or: [
          { description: RegExp(req.query.search, "i") },
          { title: RegExp(req.query.search, "i") },
          { keywords: RegExp(req.query.search, "i") },
        ],
      })
      .populate("owner")
      .then(records => {
        resolve(records.map(record => {
          let project = record.toListView();
          project.rating = _.reduce(project.rating, function (sum, vote) {
            return sum + vote.rating;
          }, 0) / project.rating.length;
          return project;
        }).filter(record => record.owner ? !record.owner.suspended : true))
      })
      .catch(err => next(err))
  });

  const kbSearch = new Promise(function(resolve) {
    const apiUrl = API + "package-list?" + qs.stringify({
      page: 1,
      search: req.query.search,
      size: PAGINATION,
    });
    request.get(apiUrl, (err, response, body) => {
      var packages = { count: 0, records: [] };

      try {
        packages = JSON.parse(body).result;
        resolve(packages.records.map(record => {
          return {
            language: ['KB'],
            type: 'rkb',
            title: record.name,
            name: record.name,
            description: record.description,
            version: record.version,
            // TODO params missing in kb,
            // author: record.author,
            // maintainer: record.maintainer,
          };
        }));
      }
      catch(e) {
        console.error(e);
        resolve()
      }
    });
  });

  Promise.all([projectSearch, kbSearch]).then(function(payloads) {
    res.json(payloads[0].concat(payloads[1]))
  });
});


/**
 * Returns all projects
 */
route.get("/search/find-projects", (req, res, next) => {
  Project
    .find({
      public: true,
      owner: { $ne: req.user },
      $or: [
        { description: RegExp(req.query.search, "i") },
        { title: RegExp(req.query.search, "i") },
      ],
    })
    .populate("owner")
    .then(records => res.json(records.map(record => record.toListView())))
    .catch(err => next(err))
});

route.get("/search/rkb/cran-packages", (req, res) => {
  var search = req.query.search || "";
  var page = req.query.page * 1;

  if ( ! page || page < 1 ) {
    page = 1;
  }

  var apiUrl = API + "package-list?" + qs.stringify({
    page,
    search,
    size: PAGINATION,
  })

  var pageUrl = SERVER + "package-search?" + qs.stringify({
    page,
    size: PAGINATION,
    package: search,
  })

  request.get(apiUrl, (err, response, body) => {
    var packages = { count: 0, records: [] };
    var totalPages = 0;

    try { packages = JSON.parse(body).result }
    catch(e) {}

    totalPages = Math.ceil(packages.count / PAGINATION);

    res.render("rkb/cran-packages", {
      count: packages.count,
      packages: packages.records,
      page: page,
      search: search,
      totalPages: totalPages,
      url: pageUrl,
    });
  });
});

module.exports = route;