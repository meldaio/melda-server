"use strict"

const Kernel      = require("./interface")
const showdown    = require("showdown")
// const showdownKatex = require("showdown-katex")
const mdInstance  = new showdown.Converter({
  tables: true,
  extensions: [
    // showdownKatex()
  ]
})
const md          = mdInstance.makeHtml.bind(mdInstance)
const KernelError = require("./error")

class Markdown extends Kernel {

  constructor(...args) {
    super(...args)
    this.name = "Markdown"
    this.ready = true
    this.isMarkup = true
  }

  init() {
    this.status = "idle"
    this.emit("status-update", this.status)
    return Promise.resolve(this)
  }

  shutdown() {
    return Promise.resolve()
  }

  eval(code) {
    var error = []
    var stderr = []
    var output = [{ data: { "text/html": md(code) } }]
    
    return { prom: Promise.resolve({ code, output, error, stderr }) }
  }

  installPackage(name) {
    return Promise.reject(
      new KernelError("There is no package manager for Markdown")
    )
  }

  removePackage(name) {
    return Promise.reject(
      new KernelError("There is no package manager for Markdown")
    )
  }

  interrupt() {
    return Promise.resolve()
  }
}

Markdown.aceMode = "markdown";
Markdown.isMarkup = true;

module.exports = Markdown