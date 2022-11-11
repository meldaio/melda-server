const AWS = require('aws-sdk')
const configuration = require("./configuration")

/**
 * AWS CONFIGURATION
 */
const { AWS_REGION } = process.env
const EFS = new AWS.EFS({ region: AWS_REGION })
/**
 * INTERNAL
 */
const NFS_STATE_CHECK_INTERVAL = 2000

var cache = {}

obj = {

  create(userId) {
    var subnets, fsId

    cache[ userId ] = null

    return configuration
      .promise()
      .then(({ network }) => {
        subnets = network.awsvpcConfiguration.subnets
        return EFS
          .createFileSystem({
            CreationToken: userId,
            PerformanceMode: "generalPurpose",
            Encrypted: false,
            ThroughputMode: "bursting",
          })
          .promise()
      })
      .then(({ FileSystemId }) => {
        fsId = FileSystemId

        return EFS
          .createTags({
            FileSystemId,
            Tags: [{
              Key: "Name",
              Value: userId,
            }]
          })
          .promise()
          .then(() => ({ FileSystemId }))
      })
      .then(({ FileSystemId }) => waitForState(FileSystemId, "FileSystem"))
      .then(({ FileSystemId }) => {
        var params = subnets.map(SubnetId => ({
          FileSystemId,
          SubnetId,
          SecurityGroups: [process.env.AWS_EFS_SECURITY_GROUP],
        }))

        var proms = params.map(param => {
          return EFS.createMountTarget(param).promise()
        })

        return Promise.all(proms)
      })
      .then(mountTargets => {
        return Promise.all(
          mountTargets.map(
            target => waitForState(target.MountTargetId, "MountTarget")
          )
        )
      })
      .then(() => {
        cache[ userId ] = fsId
        return fsId
      })
  },

  onReady(userId) {
    return new Promise((res, rej) => {
      var intervalId = setInterval(() => {
        if ( cache[ userId ] ) {
          clearInterval(intervalId)
          return res( cache[ userId ] )
        }
      }, NFS_STATE_CHECK_INTERVAL)
    })
  },

  removeCache(userId) {
    if (cache[ userId ] !== undefined) {
      delete cache[ userId ]
    }
  },

  get(userId, create = true) {
    // If its already created
    if (cache[userId]) {
      return Promise.resolve({ fsId: cache[userId] })
    }

    // Creation process already started:
    if (cache[userId] === null) {
      return this.onReady(userId)
        .then(fsId => Promise.resolve({ fsId }))
    }

    return EFS
      .describeFileSystems({ CreationToken: userId })
      .promise()
      .then(({ FileSystems }) => {
        var creation

        if (FileSystems.length) {
          cache[ userId ] = FileSystems[0].FileSystemId
          return Promise.resolve({ fsId: cache[userId] })
        }

        if (create) {
          creation = this.create(userId)
          return Promise.resolve({ fsId: null, creation })
        }

        return Promise.resolve({ fsId: null })
      })
  },

}


function waitForState(id, resourceType = "FileSystem", state = "available") {
  var endpoint = EFS["describe"+ resourceType +"s"]

  return endpoint
    .call(EFS, { [resourceType + "Id"]: id })
    .promise()
    .then((data) => {
      var resource = data[resourceType + "s"][0]

      if ( ! resource || resource.LifeCycleState !== state ) {
        return new Promise((res, rej) => {
          setTimeout(
            () => waitForState(id, resourceType, state).then(res).catch(rej),
            NFS_STATE_CHECK_INTERVAL
          )
        })
      }

      return Promise.resolve(resource)
    })
}

module.exports = obj