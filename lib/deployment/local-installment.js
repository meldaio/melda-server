const Deployment      = require("./interface.js")
const Jupyter         = require("@jupyterlab/services")
const axios           = require("axios")
const DeploymentError = require("./error")
const monitor         = require("../monitor")

const { JUPYTER_TOKEN,
  JUPYTER_HTTP_PROTOCOL,
  JUPYTER_HOST,
  JUPYTER_PORT,
  JUPYTER_WS_PROTOCOL } = process.env

const serverSettings = Jupyter.ServerConnection.makeSettings({
  token: JUPYTER_TOKEN,
  baseUrl: JUPYTER_HTTP_PROTOCOL +"://"+ JUPYTER_HOST +":"+ JUPYTER_PORT +"/",
  wsUrl: JUPYTER_WS_PROTOCOL +"://"+ JUPYTER_HOST +":"+ JUPYTER_PORT +"/",
})

/**
 * Returns a promise resolved with all available Jupyter Service Kernels.
 * @return {Promise}
 */
function allJupyterKernels() {
  return Jupyter.Kernel
    .getSpecs(serverSettings)
    .then(specs => Promise.resolve(specs.kernelspecs))
    .catch(error => Promise.reject(new DeploymentError("Couldn't connect to jupyter")))
}


var allCreatedKernels = []
var allDeadKernels = []

/**
 * @implements {Deployment} 
 * @extends    {Deployment}
 */

class LocalInstallment extends Deployment {

  static status() {
    return allCreatedKernels.map(info => {
      return {
        user: info.user,
        name: info.name,
        id: info.id,
        status: info.status,
        history: info.history,
        context: info.context
      }
    })
  }

  constructor(...args) {
    super(...args)
  }

  init() {
    return Promise.resolve(this)
  }

  startKernel(name, context) {
    var info = {
      context,
      user: {
        name: this.user.name,
        email: this.user.email
      },
      name,
      history: [{
        event: "CREATINGKERNEL",
        date: new Date,
        data: ''
      }],
      status: "CREATINGKERNEL"
    }
    allCreatedKernels.push(info)
    monitor.send("update-kernels", this.constructor.status())
    return allJupyterKernels()
      .then(kernels => {
        if ( ! kernels[ name ] ) {
          throw new DeploymentError("Jupyter kernel '" + name
            + "' is not installed")
        }

        return Jupyter.Kernel.startNew({ name, serverSettings })
      })
      .then(kernel => {
        info.id = kernel._id
        info.status = "READY"
        info.history.push({
          event: "READY",
          date: new Date,
          data: ''
        }),
        info.kernel = kernel
        monitor.send("update-kernels", this.constructor.status())
        return kernel
      })
      .catch(err => {
        info.status = "ERROR"
        info.history.push({
          event: "ERROR",
          date: new Date,
          data: err.toString()
        })
        monitor.send("update-kernels", this.constructor.status())

        throw err
      })
  }

  shutdownKernel(jupyterKernel) {
    var info = allCreatedKernels.find(_info => {
      return jupyterKernel && _info.id === jupyterKernel._id
    })

    if(! info ) {
      return Promise.resolve()
    }

    info.status = "SHUTTINGDOWN"
    info.history.push({
      event: "SHUTTINGDOWN",
      date: new Date,
      data: ''
    })    

    monitor.send("update-kernels", this.constructor.status())
    
    return jupyterKernel.shutdown()
      .then(() => {
        info.status = "DEAD"
        info.history.push({
          event: "DEAD",
          date: new Date,
          data: ''
        })

        monitor.send("update-kernels", this.constructor.status())
      })
  }

  onEval(code, jupyterKernel){
    var info = allCreatedKernels.find(_info => {
      return _info.id === jupyterKernel._id
    })

    info.history.push({
      event: "CODE",
      date: new Date,
      data: code
    })
      
    monitor.send("update-kernels", this.constructor.status())
  }

  installPackage(jupyterKernel, name) {
    var info = allCreatedKernels.find(_info => {
      return _info.id === jupyterKernel._id
    })

    return new Promise(res => setTimeout(() => {
      res(["A3","pbapply","xtable", "ABC.RAP"])
    }, 3000))
      .then(() => {
        info.history.push({
          event: "INSTALL-PACKAGE",
          date: new Date,
          data: name
        })

        monitor.send("update-kernels", this.constructor.status())
      })
  }

  removePackage(name, jupyterKernel) {

    return new Promise(res => setTimeout(res, 3000))
  }

  onResponse(response, jupyterKernel){
    var info = allCreatedKernels.find(_info => {
      return _info.id === jupyterKernel._id
    })

    info.history.push({
      event: "RESPONSE",
      date: new Date,
      data: response
    })

    monitor.send("update-kernels", this.constructor.status())
  }
}

if (process.env.DEFAULT_DEPLOYMENT === "LocalInstallment") {
  monitor.on(
    "get-kernels",
    ({ data, socket }) => socket.emit("update-kernels", LocalInstallment.status())
  )
}

module.exports = LocalInstallment
