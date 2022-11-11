"use strict"

const path = require("path")
const fs = require("fs")
const Kernel      = require("../interface")
const KernelError = require("../error")

class Python extends Kernel {

  constructor(...args) {
    super(...args)
    /**
     * Jupyter Service Kernel name.
     * @type {String}
     */
    this.jupyterKernelName = "python3"

    this.name = "Python"
  }

  eval(...args) {
    let { future, prom } = super.eval(...args)

    prom = prom.then(async mainResult => {
      let { future, prom } = super.eval("%whos")
      let result = await prom
      let table = result.output[0].text
      let globals = []

      table.split("\n").slice(2).map(line => {
        var matches = line.match(/^(.+?)\s+(.+?)\s+(.+?)$/)
        if (matches && matches[1] && matches[2] && matches[3]) {
          globals.push({
            name: matches[1],
            type: matches[2],
            content: matches[3],
            language: this.name
          })
        }
      })

      /*
      globals.forEach(item => {
        item.language = "R"
        return item
      })
      */

      mainResult.globals = globals

      return Promise.resolve(mainResult)
    })

    return { future, prom }
  }

  installPackage(name) {
    return Promise.reject(
      new KernelError("There is no package manager for Python")
    )
  }

  removePackage(name) {
    return Promise.reject(
      new KernelError("There is no package manager for Python")
    )
  }

  async getPackages(code) {
    /* TEST CODE
    code = `import a0
from  a1 import bla
from   a2
import   a3
`
     */
    var packages = []

    code.replace(/(?:^|\n)(?:import|from)\s+(\w+)/g, (match, name) => {
      packages.push(name)
      return match
    })

    return packages
  }
  
}

Python.aceMode = "python";
Python.isMarkup = false;

module.exports = Python