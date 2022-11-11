"use strict"

const fs = require("fs")
const path = require("path")
const Kernel = require("../interface")
const KernelError = require("../error")

const R_INITIAL = fs.readFileSync(path.resolve(__dirname, "./initial.R"), "utf8")

class R extends Kernel {

  constructor(...args) {
    super(...args)
    this.name = "R"
    /**
     * Jupyter Service Kernel name.
     * @type {String}
     */
    this.jupyterKernelName = "ir"
  }
  
  init() {
    return super.init()
      .then(() => super.eval(R_INITIAL))
      .then(result => this)
  }

  eval(...args) {
    let  { prom , future } = super.eval(...args);

    prom = prom.then(async mainResult => {
      let { future, prom } = super.eval(`toJSON(list( globals = .rcultureGlobals() , dependencies = list() ),
      auto_unbox = T, pretty = T, null = "null")`)
      let result = await prom

      try {
        let output = result.output[0].data["text/plain"]
        
        let { globals , dependencies } = JSON.parse(output); 
        globals.forEach(item => {
          item.language = this.name
          return item
        })
  
        mainResult.globals = globals
        mainResult.dependencies = dependencies

        return Promise.resolve(mainResult)
      }
      catch(e) {
        console.error(e)
        console.log("HERE", result)
      }

      return Promise.resolve(mainResult)
    })

    return { future, prom }
  }

  getPackages(code) {
    /* TEST CODE
    code = `library("a1")
        library(a2)
        library ( a3   )
        library  (   'a4' )
        library  (   qewr.fdsa )
        require(B2)
        require("b3")
        require  ( "b4"   )
        C3::fsd()` */

    var packages = []

    code.replace(/(?:library|require)\b\s*?\((.+)\)/g, (match, name) => {
      name = name.trim().replace(/^"(.+)"$|^'(.+)'$/, "$1$2")
      packages.push(name)
      return match
    })

    code.replace(/\b(.+)::/, (match, name) => {
      name = name.trim()
      packages.push(name)
      return match
    })

    return Promise.resolve(packages)
  }
}

R.aceMode = "r";
R.isMarkup = false;

module.exports = R;
