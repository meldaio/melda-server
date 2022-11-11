const redis = require('redis')
const session = require('express-session')
const RedisStore = require('connect-redis')(session)
const { REDIS_HOST, REDIS_PORT, COOKIE_SECRET, COOKIE_LIFETIME } = process.env;
const redisClient = redis.createClient({ host: REDIS_HOST, port: REDIS_PORT })

const sessionParser = session({
  store: new RedisStore({ client: redisClient }),
  secret: COOKIE_SECRET,
  maxAge: COOKIE_LIFETIME,
  resave: false,
  saveUninitialized: true,
})

module.exports = sessionParser