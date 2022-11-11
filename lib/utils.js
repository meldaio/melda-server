const slugify = require("slugify")
const net = require('net')
const nodeCleanup = require('node-cleanup')
const axios = require("axios")


module.exports.uuid = function() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8)
    return v.toString(16)
  })
}

/**
 * Creates a slug from the given string, supports Turkish chars
 * Uses "-" for whitespaces
 * @param  {String} text
 * @return {String}
 */
module.exports.slugify = text => slugify(text ||
  "", { replacement: "-", lower: true })
  .replace(/[^a-z0-9_-]/g, "")




module.exports.isInBetween = isInBetween
function isInBetween(number, ...ranges) {
  for (var i = 0; i < ranges.length; i++) {
    if (ranges[i][0] <= number && ranges[i][1] >= number) {
      return true
    }
  }
  return false
}



module.exports.isValidHttpStatusCode = number => Number(number) && isInBetween(
  Number(number),
  [100, 102], [200, 208], [226, 226], [300, 308], [400, 418], [420, 420],
  [422, 426], [428, 429], [431, 431], [444, 444], [449, 451], [499, 499],
  [500, 511], [598, 599]
)

function portInUse(portNumber) {
  return new Promise(res => {
    var server = net.createServer(function(socket) {
      socket.write('Echo server\r\n');
      socket.pipe(socket);
    });

    server.listen(portNumber);

    server.on('error', function(e) {
      res(true);
    });

    server.on('listening', function() {
      server.close();
      res(false);
    });

    // TODO: investigate if IPv6 check is required
  })
}
module.exports.portInUse = portInUse

module.exports.findOpenPorts = function(startFrom = 5000, total = 5) {
  var ports = []
  var counter = 0

  var rec = function() {
    var port = startFrom + counter

    return portInUse(port)
      .then(inUse => {
        !inUse && ports.push(port)
        counter++

        if (ports.length < total)
          return rec()

        return Promise.resolve(ports)
      })
  }

  return rec()
}



/**
 * onTerminate callback to take action when app stops for some reason.
 * Callbacks must return a promise
 * @type {Array}
 */
var onTermCbs = []
var onTerminationFinish = () => process.kill(process.pid, 'SIGINT')
var onTerminate = cb => onTermCbs.push(cb)
nodeCleanup((exitCode, signal) => {
  Promise
    .all(onTermCbs.map(fn => fn(exitCode, signal)))
    .then(onTerminationFinish)
    .catch(onTerminationFinish)

  nodeCleanup.uninstall()
  return false
})
module.exports.onTerminate = onTerminate
/**
 * Parses ARN (Amazon Resource Name) string.
 * @example resourceName arg
 *   arn:aws:ecs:eu-west-1:123123123:task/asdf
 * @example returned object
 *   {
 *     valid: true,
 *     service: "ecs",
 *     region: "eu-west-1",
 *     account: "123123123",
 *     type: "task",
 *     name: "asdf"
 *   }
 * @param  {String} resourceName
 * @return {Object}
 */
module.exports.parseArn = function parseArn(resourceName) {
  var result = { valid: false }
  var regex = new RegExp("^arn:aws:"
    + "([^:]+):"  // Service name
    + "([^:]+)?:" // Region (optional?)
    + "([^:]+):"  // Account id
    + "([^/]+/)?" // Resource type (optional?)
    + "(.+)$"     // Resource name
  )
  var match = resourceName.match(regex)

  if (match) {
    result = {
      valid: true,
      service: match[1],
      region: match[2],
      account: match[3],
      type: match[4]
        ? match[4].replace(/\/$/, "")
        : undefined,
      name: match[5],
    }
  }

  return result
}
/**
 * Builds ARN (Amazon Resource Name) string from given object.
 * @param  {Object} obj ARN object
 * @return {String}
 */
module.exports.buildArn = function buildArn(obj) {
  if (typeof obj === "string") {
    obj = { name: obj }
  }

  obj = Object.assign({
    service: "ecs",
    region: process.env.AWS_REGION,
    account: process.env.AWS_ACCOUNT_ID,
  }, obj)

  return "arn:aws:"
    + obj.service + ":"
    + obj.region + ":"
    + obj.account + ":"
    + (obj.type ? obj.type + "/" : "")
    + obj.name
}

/**
 * @param  {Object} obj 
 * @return {Array}  cells
 */
module.exports.convertMeldaJSONtoStage = function convertMeldaJSONtoStage(obj, index) {
  var cells = []
  var allStages = []
  var stageName = ''

  var tempProject = obj.project
  var stages = tempProject.stages
  if ( Object.keys(stages).length == 1 ) {
    let stage = stages[0]
    cells = stage.cells
  }
  else {
    for ( let i = 0; i < Object.keys(stages).length; i++ ) {
      let stage = stages[i]
      stageName = stages[index]
      cells = stage.cells
      allStages.push(cells)
    }
    cells = { cells: Object.values(allStages)[index], name: stageName.title }
  }

  return cells
 
}

/**
 * @param  {Object} object 
 * @return {Array}  result
 */
module.exports.convertRmdtoStage = async function(obj) {
  result = []
  const res =  await axios.post(`${process.env.RMD_CONVERTER_URL}/convert`, 
  {
    file: obj,
  })
  result = res.data
  return result
}

/**
 * @param  {Object} ipynb 
 * @return {Array}  result
 */
module.exports.convertIpynbToStage = function convertIpynbToStage(ipynb) {
  var concat = Array.prototype.concat
  var cells = []
  var i = 0

  var languages = {
    python: "Python",
    markdown: "Markdown",
    r: "R",
    html: "HTML"
  }

  var defaults = {
    hiddenCode: false,
    hiddenOutput: false,
    dontEvaluate: false,
    evaluated: true,
    isMarkup: true,
    created: new Date(),
  }

  if (ipynb.cells && Array.isArray(ipynb.cells)) {
    cells = ipynb.cells
  } else if (ipynb.worksheets && Array.isArray(ipynb.worksheets)) {
    cells = concat.apply([], ipynb.worksheets.map(ws => ws.cells))
  }

  return cells
    .map(cell => {
      var output
      var type = cell.cell_type.toLowerCase()
      var result = Object.assign({}, defaults, {
        code: "",
        language: type,
        output: [],
        error: [],
      })

      // Code
      if (cell.source && Array.isArray(cell.source)) // Markdown
        result.code = cell.source.join("")
      else if (cell.input && Array.isArray(cell.input)) // Code
        result.code = cell.input.join("")
      else if (cell.source) {
        result.code = cell.source
        result.isMarkup = false
      }
      // Output
      if (cell.outputs && Array.isArray(cell.outputs)) {
        result.output = cell.outputs.map(output => {
          if (output.data) {
            for (var mime in output.data) {
              if ( Array.isArray(output.data[mime]) ) {
                output.data[mime] = output.data[mime].join("")
              }
            }
          }

          if (output.text && Array.isArray(output.text)) {
            output.text = output.text.join("")
          }

          if (output.json && Array.isArray(output.json)) {
            output.json = output.json.join("")
          }

          return output
        })
      }

      // Language
      if (type === "code") {
        if (ipynb.metadata
          && ipynb.metadata.kernelspec
          && ipynb.metadata.kernelspec.language) {
          result.language = ipynb.metadata.kernelspec.language
            .toLowerCase()
        } else if (cell.language) {
          result.language = cell.language.toLowerCase()
        }
        //Some versions of ipynb files does not contain language info
        else if(!ipynb.metadata.kernelspec){
          result.language = "r" 
        }
        //Some versions of ipynb files contain kernelspec name instead of language
        else if (ipynb.metadata.kernelspec.name === "python" || ipynb.metadata.kernelspec.name === "python3"){
          result.language = "python"
        }
      }

      

      if ( ! result.language || ! languages[ result.language ] ) {
        return false
      }

      if ( ! result.code ) {
        return false
      }

      result.language = languages[ result.language ]

      return result
    })
    .filter(cell => !!cell)
    .map((cell, i) => {
      cell.index = i + 1
      return cell
    })
}

module.exports.convertStageToRmd = function(data, header = 'Untitled') {
  var result = ''

  var title = '\n---\ntitle: ' + header + '\noutput: html_notebook\n---\n'
  result = title

  if (data) {
    for (var i = 0; i < data.length; i++) {
      let dataBlock = data[i]
      
      if (dataBlock.language == 'Markdown') {
        result += dataBlock.code + '\n'
      } else if (dataBlock.language === 'Python') {
        result += `\`\`\`{python}\n${dataBlock.code}\n\`\`\`` + '\n'
      } else if (dataBlock.language === 'R') {
        let attributes = ''

        if (dataBlock.hiddenCode) {
          attributes += 'echo=FALSE '
        }

        if (dataBlock.hiddenOutput) {
          attributes += 'include=TRUE '
        }

        if (dataBlock.dontEvaluate) {
          attributes += 'eval=FALSE '
        }
        
        if (attributes) {
          result += '`\`\`\`{r ' + attributes + '}' + `\n${dataBlock.code}\n\`\`\`` + '\n'
        } else {
          result += `\`\`\`{r}\n${dataBlock.code}\n\`\`\`` + '\n'
        }
      } else if (dataBlock.language === 'HTML') {
        result += '<h1>' + dataBlock.code + '</h1>' + '\n'
      }
    }
  }

  return result
}

/**
 * Returns the not allowed namespaces by using the vue router's
 * routes object in the client. In this case, not allowed namespaces 
 * are the first params of the routes.
 *
 * @return {Array}
 */
module.exports.getNotAllowedNamespaces = () => {
  const path = require('path')
  const clientPath = process.env.CLIENT_PATH
  const routesPath = path.join(process.cwd(), clientPath, 'src/router/routes')
  const routes = require(routesPath)
  const notAllowedNamespaces = []

  routes.forEach(route => {
    const params = route.path.split('/', 2)

    if (params[1]) {
      notAllowedNamespaces.push(params[1]) 
    }
  })

  return notAllowedNamespaces
}