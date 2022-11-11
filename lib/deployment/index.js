const LocalInstallment = require("./local-installment")
const LocalDocker = require("./local-docker")
const AWSECS = require("./aws-ecs")

const allDeployments = { LocalInstallment, LocalDocker, AWSECS }

module.exports = {

  /**
   * Returns a promise resolved with given user's Deployment object.
   * Runs init automatically.
   * @param  {Object}  user User object. Has to contain
   *                        deployment configuration.
   * @return {Promise}      Resolved with Deployment object.
   */
  get(user) {
    /*
    var { deployment } = user

    if ( ! deployment || ! deployment.type ) {
      throw new Error("Missing deployment configuration")
    }

    if ( ! allDeployments[ deployment.type ] ) {
      throw new Error(`Deployment option "${deployment.type}" not found`)
    }
    */

    return allDeployments[ process.env.DEFAULT_DEPLOYMENT ].get(user)
  }

}