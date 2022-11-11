"use strict"
const axios = require('axios')
const router     = require("express").Router()
const request     = require("request")
const qs          = require('querystring')
const UserError = require("../../lib/user-error.js");
const { Cell, Project } = require("../../models")
const  bodyParser = require('body-parser')

const PAGINATION = 5
const API        = process.env.RCULTURE_SERVER + "api/"
const SERVER     = process.env.RCULTURE_SERVER
const APISERVER = "https://kbdev.melda.io/"

class RKBRouteError extends UserError {}

router.get("/rkb", (req, res) => {
  res.render("rkb/index");
});

router.get("/rkb/search", (req, res) => {
  let search = req.query.q || "gg";
  let page = Number(req.query.page || 1);
  let searchIn = req.query.in || "all" 
  let size =  req.query.size || 5

  let apiUrl = APISERVER + "search?q=" +search +"&in="+ searchIn 
   + "&size=" + size + "&page="+page
  
  request.get(apiUrl, (err, response, body) => {
    let packages = { count: 0, records: [] };
    let totalPages = 0;

    try { packages = JSON.parse(body) }
    catch(e) {  }
    totalPages = Math.ceil(packages.count / PAGINATION);
    
    return res.json({
        packages: packages.packages,
        methods: packages.methods,
        page: page,
        search: search,
      })  
    })
    
  });



router.get("/rkb/cran-packages", (req, res) => {
  let search = req.query.search || "";
  let page = req.query.page * 1;
  if ( ! page || page < 1 ) {
    page = 1;
  }

  let apiUrl = API + "package-list?" + qs.stringify({
    page,
    search,
    size: PAGINATION,
  })

  let pageUrl = SERVER + "package-search?" + qs.stringify({
    page,
    size: PAGINATION,
    package: search,
  })

  request.get(apiUrl, (err, response, body) => {
    let packages = { count: 0, records: [] };
    let totalPages = 0;

    try { packages = JSON.parse(body).result }
    catch(e) {}

    totalPages = Math.ceil(packages.count / PAGINATION);

    function finish() {
      res.json({
        count: packages.count,
        packages: packages.records,
        page: page,
        search: search,
        totalPages: totalPages,
      })
    }
  });
});

router.get("/rkb/cran-package-detail", (req, res, next) => {
  let packageName = decodeURIComponent(req.query.package);
    
  let  packageDetail = APISERVER +"api/package-detail?" + qs.stringify({ package: packageName })
  let  methodList = APISERVER + "api/method-list?" + qs.stringify({ package: packageName })
  let packageQuery =  APISERVER + "search?q=" +packageName  +"&in=package&size=1000&page=1";

  (async () => {
    try {
      const [ packageRes, methodRes,allPackageRes ] = await axios.all([
        axios.get( packageDetail ),
        axios.get( methodList ),
        axios.get( packageQuery )
      ]);

      allPackageRes.data.packages = allPackageRes.data.packages.map(  item => ( item.name) )
      
      let cells = await Cell.find({ 
        "dependencies.package": {
          $in: allPackageRes.data.packages
        } 
      })
      
      let projects = await Project.find({
        "_id":{
          $in: cells.map( cell => cell.project)
        }
      }).populate("owner")

      res.send({
        "package":packageRes.data.result,
        "methods":methodRes.data.result.records,
        "projects":projects.map( project => project.export())
      })
    } catch (error) {}
  })();
});


router.get("/rkb/cran-method-detail", (req, res) => {
  let packageName = decodeURIComponent(req.query.package);
  let methodName = decodeURIComponent(req.query.method);

  let  packageDetail = APISERVER +"api/package-detail?" + qs.stringify({ package: packageName })
  let methodDetail = APISERVER + "api/method-detail?" + qs.stringify({ package: packageName, 
    method: methodName })
  let methodQuery =  APISERVER + "search?q=" + methodName  +"&in=method&size=1000&page=1";

(async () => {
  try {
    const [ packageRes, methodRes,allMethodRes ] = await axios.all([
      axios.get( packageDetail ),
      axios.get( methodDetail ),
      axios.get( methodQuery )
    ]);
    allMethodRes.data.methods = allMethodRes.data.methods.map(  
      item => ( item.packageName + '::' + item.name ) )
    
    let cells = await Cell.find({ 
      "dependencies.method": {
        $in: allMethodRes.data.methods
      } 
    })
    
    let projects = await Project.find({
      "_id":{
        $in: cells.map( cell => cell.project)
      }
    }).populate("owner")

    res.send({
      "package":packageRes.data.result,
      "method":methodRes.data.result,
      "projects":projects.map( project => project.export())
    })
  } catch (error) {}
})();
  
});

module.exports = router;
