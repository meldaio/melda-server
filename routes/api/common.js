const route = require('express').Router()
const { User, Project } = require("../../models");
const RouteError = require("../route-error")
const { sendEmail } = require("../../lib/email")
const version = process.env.VERSION

route.get('/version', (req, res, next) => res.send({ version }))

/**
 * Returns general stats for melda
 */
route.get('/metrics', async (req, res, next) => {
  try {
    const metrics = {}

    metrics.projects = await Project.countDocuments()
    metrics.forkedProjects = await Project.countDocuments({ forked: true })
    metrics.users = await User.countDocuments()
    metrics.usersForkedProject = (await Project.find({ forked: true }).distinct('owner')).length

    res.json(metrics)
  } catch (e) {
    next(new RouteError('Could not get metrics', 500))
  }
})

/**
 * Sends email to connect@pranageo.com
 */
route.post('/send-email', async (req, res, next) => {
  const { name, email, subject, text } = req.body
  try {
    await sendEmail('ContactForm', {subject, text, name, email}, ['connect@pranageo.com'], email, false)
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    next(new RouteError('Something went wrong', 500))
  }
})

module.exports = route
