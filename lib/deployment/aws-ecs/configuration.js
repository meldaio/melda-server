const AWS = require('aws-sdk')
const { parseArn, buildArn } = require("../../utils")
const DeploymentError = require("../error")

/**
 * AWS CONFIGURATION
 */
const { AWS_REGION,
  AWS_ACCOUNT_ID,
  AWS_LAUNCH_TYPE,
  AWS_CLUSTER } = process.env
const ECS = new AWS.ECS({ region: AWS_REGION })
const EC2 = new AWS.EC2({ region: AWS_REGION })

var ready, network, cluster
var callbacks = []

var obj = {
  ECS, EC2,

  ready(cb) {
    var _cb

    if ( ! cb ) {
      ready = true
    } else {
      callbacks.push(cb)
    }

    if (ready === true) {
      while (_cb = callbacks.shift()) {
        _cb({ cluster, network })
      }
    }
  },

  promise() {
    return new Promise((res, rej) => {
      this.ready(config => res(config))
    })
  },

  start() {
    // Set cluster arn
    var clusterProm = ECS
      .listClusters()
      .promise()
      .then(({ clusterArns }) => {
        var result = clusterArns.map(arn => parseArn(arn))
          .find(obj => obj.name === AWS_CLUSTER)

        if ( ! result ) {
          throw new DeploymentError("Cluster couldn't be found")
        }

        cluster = buildArn(result)
      })


    // Set network configuration
    var subnets, securityGroups
    var Filters = [{
      Name: "group-name",
      Values: ["melda-kernels"],
    }]

    var networkProm = EC2
      .describeSecurityGroups({ Filters })
      .promise()
      .then(({ SecurityGroups }) => {
        if ( ! SecurityGroups || SecurityGroups.length < 1 ) {
          throw new DeploymentError("Security group couldn't be found")
        }

        securityGroups = [ SecurityGroups[0].GroupId ]

        Filters = [{
          Name: "vpc-id",
          Values: [ SecurityGroups[0].VpcId ]
        }]

        return EC2
          .describeSubnets({ Filters })
          .promise()
      })
      .then(({ Subnets }) => {
        if ( ! Subnets || Subnets.length < 1 ) {
          throw new DeploymentError("Subnets couldn't be found")
        }

        subnets = Subnets.map(subnet => subnet.SubnetId)

        network = {
          awsvpcConfiguration: {
            subnets,
            securityGroups,
            assignPublicIp: AWS_LAUNCH_TYPE === "FARGATE"
              ? "ENABLED"
              : "DISABLED"
          }
        }
      })

    Promise
      .all([networkProm, clusterProm])
      .then(() => obj.ready())
      .then(() => console.info("AWS configuration is ready"))
      .catch(err => console.error(err))

    return this
  }
}

if (process.env.DEFAULT_DEPLOYMENT === "AWSECS") {
  obj.start()
}

module.exports = obj







