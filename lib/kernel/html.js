"use strict"

const Kernel      = require("./interface")
const KernelError = require("./error")

class HTML extends Kernel {

  constructor(...args) {
    super(...args);
    this.name = "HTML";
    this.ready = true;
    this.isMarkup = true;
    this.aceMode = "html";
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
    var output = [{ data: { "text/html": code } }]

    return { prom: Promise.resolve({ code, output, error, stderr }) }
  }

  installPackage(name) {
    return Promise.reject(
      new KernelError("There is no package manager for HTML")
    )
  }

  removePackage(name) {
    return Promise.reject(
      new KernelError("There is no package manager for HTML")
    )
  }

  interrupt() {
    return Promise.resolve()
  }
}

HTML.aceMode = "html";
HTML.isMarkup = true;

module.exports = HTML;