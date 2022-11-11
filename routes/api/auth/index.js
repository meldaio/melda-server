const route = require('express').Router()
const passport = require('passport')
const request = require('request')
const fs = require('fs')
const path = require('path')
const AuthError = require('./auth-error.js')
const { User } = require('../../../models')
const { lte } = require('lodash')

const userPhotoDir = 'uploads/users/'
const { BASE } = process.env

module.exports = route

class UnauthorizedError extends AuthError {
  constructor(...args) {
    super(...args)
    this.message = 'Unauthorized'
  }
}

route.use(passport.initialize())
route.use(passport.session())

passport.serializeUser((user, done) => done(null, user))
passport.deserializeUser((user, done) => done(null, user))

route.post('/sign-in', async (req, res, next) => {
  const { email, password } = req.body
  const user = await User.authenticate(email, password)
  if (!user) {
    return next(new AuthError('User not found'))
  }
  req.session.user = user.export()
})

route.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err){
      console.error(err);
    } else{
      res.redirect('/');
    }
 });
})

route.use(async (req, res, next) => {
  if (!req.session.user) {
    if (req.query.token) {
      const user = await User.findOne({ apiKey: req.query.token })
      
      if (user) {
        req.session.user = user.exportPublic()
        
        return next()
      }
    }

    return next(new UnauthorizedError())
  }

  next()
})

// Utility functions
function createUserSession(req, res) {
  const user = req.user

  if (!user ) {
    return res.redirect(BASE)
  }

  req.session.user = user

  if (req.query.state) {
    return res.redirect(req.query.state)
  }
  
  res.redirect(BASE)
}

async function processProfile(profile) {
  var user = await User.findOne({ id: profile.id, email: profile.email })
  var photo = profile.photo

  delete profile.photo

  if (!user ) {
    user = new User
  }

  Object.assign(user, profile)

  try {
    user = await user.save()
  } catch(err) {
    console.error(err)
  }

  if (photo && !hasPhoto(user)) {
    user = await savePhoto(user, photo)
  }

  return user.export()
}

function hasPhoto(user) {
  if (!user.photo) {
    return false
  }

  return fs.existsSync(userPhotoDir + user.photo)
}

function savePhoto(user, photo) {
  const url = photo
  const ext = path.extname(photo)
  const file = user.id + ext
  
  request(url).pipe(fs.createWriteStream(userPhotoDir + file))
  
  user.photo = file
  
  return user.save()
}
