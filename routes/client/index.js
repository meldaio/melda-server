const express = require('express')
const route = express.Router()
const { createBundleRenderer } = require('vue-server-renderer')
const fs = require('fs')
const path = require('path')

const clientPath = path.resolve(process.env.CLIENT_PATH)
const bundle = require(clientPath + '/dist/vue-ssr-server-bundle.json')
const clientManifest = require(clientPath + '/dist/vue-ssr-client-manifest.json')
const template = fs.readFileSync(clientPath + '/index-template.html', 'utf8')
const renderer = createBundleRenderer(bundle, { template, clientManifest })

route.use('/dist', express.static(clientPath + '/dist'))

route.get('/', (req, res, next) => {
  if (req.session.user) {
    res.redirect('/dashboard')
  } else {
    renderer.renderToString(context(req), (err, html) => {
      if (err) {
        console.error(err)
      } else {
        res.end(html)
      }
    })
  }
})

route.get('/explore', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/explore/:category', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/cran', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/login', (req, res, next) => {
  if (req.session.user) {
    return res.redirect('/dashboard')
  }

  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/join', (req, res, next) => {
  if (req.session.user) {
    return res.redirect('/dashboard')
  }

  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/verify', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/forgot-password', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/reset-password', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/search', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/dashboard', (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/')
  }

  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

route.get('/view/:namespace/:project/:stage?/:cell?', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})
route.get('/:namespace/:project/:stage?/:cell?', (req, res, next) => {
  if (req.session.classroom && req.session.classroom.activeMeeting) {
    req.session.classroom.activeProject = req.url;
  }
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})
route.get('/:namespace', (req, res, next) => {
  renderer.renderToString(context(req), (err, html) => {
    if (err) {
      console.error(err)
    } else {
      res.end(html)
    }
  })
})

module.exports = route
const default_class = {
  activeMeeting: {},
  activeProject: '',
  activeUsers: [],
}
function context(req, data = {}) {
  return Object.assign({
    url: req.url,
    user: req.session.user,
    meeting: req.session.classroom || default_class,
    baseURL: process.env.BASE,
    adminURL: process.env.ADMIN_URL,
    assetsURL: process.env.BASE+ 'api/',
    apiURL: process.env.BASE + 'api/',
    siteKey: process.env.SITE_KEY,
    render: true,
    isEditor: req.session.isEditor,
    language: req.session.language
  }, data)
}
