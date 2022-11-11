const Deployment      = require("./interface.js")
const Docker          = require("dockerode")
const Jupyter         = require("@jupyterlab/services")
const axios           = require("axios")
const DeploymentError = require("./error")
const { uuid, findOpenPorts, onTerminate } = require("../utils")

const DOCKER_CONFIG = { socketPath: '/var/run/docker.sock' }
const JUPYTER_CONTAINER_PORTS = [ 8888, 8889 ]
const KERNEL_CONTAINER_PORTS = [ 5000, 5001, 5002, 5003, 5004 ]
const KERNEL_CONTAINER_NAMES = {
  ir: "melda/irkernel",
  python3: "melda/ipython"
}

const { JUPYTER_TOKEN,
  JUPYTER_HTTP_PROTOCOL,
  JUPYTER_HOST,
  JUPYTER_PORT,
  JUPYTER_WS_PROTOCOL,
  JUPYTER_HELPER_HOST,
  JUPYTER_HELPER_PORT,
  JUPYTER_HELPER_HTTP_PROTOCOL } = process.env

const serverSettings = Jupyter.ServerConnection.makeSettings({
  token: JUPYTER_TOKEN,
  baseUrl: JUPYTER_HTTP_PROTOCOL +"://"+ JUPYTER_HOST +":"+ JUPYTER_PORT +"/",
  wsUrl: JUPYTER_WS_PROTOCOL +"://"+ JUPYTER_HOST +":"+ JUPYTER_PORT +"/",
})

const JUPYTER_HELPER_SERVER = JUPYTER_HELPER_HTTP_PROTOCOL
  + "://" + JUPYTER_HELPER_HOST + ":" + (JUPYTER_HELPER_PORT || "80") + "/"

const docker = new Docker(DOCKER_CONFIG)

// All created instances
var allInstances = []


module.exports = class LocalDocker extends Deployment {
  constructor(...args) {
    super(...args)
    allInstances.push(this)
    /**
     * Kernel bridge network
     * @type {Network}
     */
    this.kernelBridge = null
    /**
     * Jupyter container object
     * @type {Container}
     */
    this.jupyterContainer = null
    /**
     * Kernel informations indexed by kernel id.
     * Each item contains kernelName, container, ip, config and jupyterKernel.
     * @type {Object}
     */
    this.kernels = {}
  }
  /**
   * Creates kernel bridge network and Jupyter container.
   * @return {Promise} resolved with this context.
   */
  init() {
    // If its already initialized.
    if (this.isReady()) {
      return Promise.resolve(this)
    }
    // Try to find "melda-kernel-bridge" network
    return this.getKernelBridgeNetwork()
      // If not found, create
      .then(network => network || this.createKernelBridgeNetwork())
      // Register network
      .then(network => this.kernelBridge = network)
      // Try to find any container named "melda-jupyter-container"
      .then(() => this.getJupyterContainer())
      // If there is no melda-jupyter container, create one
      .then(container => container || this.createJupyterContainer())
      .then(container => {
        // Now register container
        this.jupyterContainer = container
        // Get its status
        return container.inspect()
      })
      // If container is not running, start it
      .then(stats => stats.State.Running || this.jupyterContainer.start())
      // Trigger ready event
      .then(() => this.ready())
      // We need to return a promise resolved with this context
      .then(() => Promise.resolve(this))
  }
  /**
   * Starts a kernel with the given name. Creates kernel container and registers
   * its connection information to jupyter.
   * @param  {String}  kernelName Kernel name: "ir" or "python3".
   * @return {Promise}            Resolved with Jupyter service kernel object
   */
  startKernel(kernelName) {
    return this.init().then(() => {
      var id = uuid()
      var kernel

      // Create kernel container
      return this.createKernelContainer(id, kernelName)
        // Start created container
        .then(container => container.start())
        .then(container => {
          // Store container and kernel type
          kernel = this.kernels[ id ] = { id, container, kernelName }

          return this.getKernelIp(id)
        })
        .then(ip => {
          if ( ! ip ) throw new DeploymentError("Cannot get kernel IP")
          // Store ip.
          kernel.ip = ip
        })
        // Create configuration on melda-jupyter-container.
        .then(() => this.createKernelConfiguration(id))
        // Store config.
        .then(({ config }) => kernel.config = config)
        // Create a dummy kernel and swap its configuration with the one
        // just created.
        .then(() => {
          return Jupyter.Kernel.startNew({
            name: kernel.kernelName + "-" + id,
            // name: kernel.kernelName,
            serverSettings
          })
        })
        // Store the jupyter kernel object and resolve the main promise
        // with it
        .then(jupyterKernel => kernel.jupyterKernel = jupyterKernel)
    })
  }
  /**
   * Removes opened kernel instance from jupyter server, kills kernel container
   * and removes kernel container.
   * @param  {Object}  jupyterKernel Jupyter service kernel object
   * @return {Promise}
   */
  shutdownKernel(jupyterKernel) {
    var kernel

    for (var id in this.kernels) {
      let _kernel = this.kernels[id]
      if (this.kernels[id].jupyterKernel._id === jupyterKernel._id) {
        kernel = this.kernels[id]
      }
    }

    // It's already shutdown
    if ( ! kernel ) {
      return Promise.resolve()
    }

    return kernel.jupyterKernel.shutdown()
      .then(() => delete this.kernels[ kernel.id ])
      .then(() => kernel.container.stop())
      .then(cont => cont.remove())
  }
  /**
   * Creates "melda-kernel-bridge" network.
   * @return {Promise} Resolved with created network.
   */
  createKernelBridgeNetwork() {
    return docker
      .createNetwork({
        Name: "melda-kernel-bridge",
        CheckDuplicate: true,
        Driver: "bridge",
      })
  }
  /**
   * Returns a promise resolved with network named "melda-kernel-bridge".
   * If there isn't any network with this name, resolves promise with "null".
   * @return {Promise}
   */
  getKernelBridgeNetwork() {
    return docker
      .listNetworks({ filters: { name: ["melda-kernel-bridge"] } })
      .then(networks => {
        return Promise.resolve(
          networks.length > 0
            ? docker.getNetwork(networks[0].Id)
            : null
        )
      })
  }
  /**
   * Creates "melda-jupyter" container.
   * Important: Container won't be running.
   * @return {Promise} Resolved with created container.
   */
  createJupyterContainer() {
    return docker
      .createContainer({
        name: "melda-jupyter-container",
        Image: "melda/jupyter",
        ExposedPorts: getExposedPorts(JUPYTER_CONTAINER_PORTS),
        HostConfig: {
          NetworkMode: "melda-kernel-bridge",
          PortBindings: getPortBindings(JUPYTER_CONTAINER_PORTS),
        }
      })
  }
  /**
   * Returns a promise resolved with container named "melda-jupyter-container".
   * If there isn't any container with this name, resolves promise with "null".
   * Important: Container may not be running.
   * @return {Promise}
   */
  getJupyterContainer() {
    return docker
      .listContainers({
        all: true,
        filters: { name: ["melda-jupyter-container"] }
      })
      .then(containers => {
        return Promise.resolve(
          containers.length > 0
            ? docker.getContainer(containers[0].Id)
            : null
        )
      })
  }
  /**
   * Creates a kernel with the given id and kernel type (defined with
   * kernelName).
   * @param  {String}  id         Kernel id
   * @param  {String}  kernelName Kernel kernelName
   * @return {Promise}            Resolved with container
   */
  createKernelContainer(id, kernelName) {
    if ( ! KERNEL_CONTAINER_NAMES[kernelName] ) {
      return Promise.reject(new DeploymentError("Jupyter kernel '" + kernelName
        + "' is not installed"))
    }

    return docker
      .createContainer({
        name: id,
        Image: KERNEL_CONTAINER_NAMES[kernelName],
        ExposedPorts: getExposedPorts(KERNEL_CONTAINER_PORTS),
        HostConfig: {
          NetworkMode: "melda-kernel-bridge",
          Privileged: true,
          // PortBindings: getPortBindings(KERNEL_CONTAINER_PORTS),
        }
      })
  }
  /**
   * Returns a promise resolved with kernel's ip address.
   * Resolves promise with null if not found.
   * @param  {String}  id Kernel id
   * @return {Promise}
   */
  getKernelIp(id) {
    return this.getKernelBridgeNetwork()
      .then(network => network.inspect())
      .then(stats => {
        if (stats.Containers) {
          for (var containerId in stats.Containers) {
            if (stats.Containers[ containerId ].Name === id) {
              return stats.Containers[ containerId ].IPv4Address
                .replace(/\/\d+$/, "")
            }
          }
        }

        return null
      })
  }
  /**
   * Creates the kernel configuration json in jupyter's runtime directory.
   * Returns a promise resolved with an object contains id and the
   * configuration.
   * @param  {String}  id Kernel id
   * @return {Promise}
   */
  createKernelConfiguration(id) {
    var kernel = this.kernels[id]

    return axios
      .get(JUPYTER_HELPER_SERVER + "create-kernel-config", {
        params: {
          id,
          ip: kernel.ip,
          kernel_name: kernel.kernelName,
        }
      })
      .then(response => response.data)
  }

  destroy() {
    var proms = []
    for (var id in this.kernels) {
      proms.push(this.shutdownKernel(this.kernels[id].jupyterKernel))
    }

    return Promise.all(proms)
      .then(() => this.getJupyterContainer())
      .then(cont => cont && cont.kill())
      .then(cont => cont && cont.remove())
      .then(() => this.getKernelBridgeNetwork())
      .then(network => network && network.remove())
  }
}


function getExposedPorts(ports) {
  return ports.reduce((result, current) => {
    result[current + "/tcp" ] = {}
    return result
  }, {})
}


function getPortBindings(ports, hostPorts) {
  var i = 0
  hostPorts = hostPorts || ports

  return ports.reduce((result, current) => {
    result[current + "/tcp" ] = [{ "HostPort": String(hostPorts[i++]) }]
    return result
  }, {})
}




onTerminate(function(exitCode, signal) {
  if (allInstances.length > 0) {
    console.log("\nRemoving Docker containers and networks, please wait...")
    return Promise.all(allInstances.map(ins => ins.destroy()))
  }
})



