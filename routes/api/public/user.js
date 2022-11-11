const route = require("express").Router();
const RouteError = require("../../route-error");
const { User, Project, Team } = require("../../../models");
const MeldaUri = require("../../../lib/melda-uri");
const axios = require("axios");
const FormData = require("form-data");
const generator = require("generate-password");
const _ = require("lodash");
const { generateFromEmail, generateUsername } = require("unique-username-generator");

const password = generator.generate({
  length: 10,
  numbers: true,
  strict: true,
  symbols: true,
});

const userName = generator.generate({
  length: 8,
  numbers: false,
  lowercase: true,
  uppercase: false,
});


class EmailDuplicationError extends RouteError {}

/**
 * Create a user
 */
route.post("/sign-up", async (req, res, next) => {
  try {
    let userData = req.body;

    userData.m_password = password;
    userData.m_userName = userData.email.replace(/[^0-9A-Z]+/gi, "");
    userData.isVerified = process.env.NODE_ENV === "test";
    const user = await User.create(userData);
    await user.sendVerificationEmail();
    res.json(user.exportPublic());
  } catch (error) {
    if (error.code === 11000 || error._message === 'User validation failed') {
      return next(
        EmailDuplicationError.wrap(
          error,
          "Email address is already in use",
          409
        )
      );
    }
    next(RouteError.wrap(error, "Invalid request body", 400));
  }
});

/**
 * Returns the given user's projects
 */
route.get("/projects/:namespace", async (req, res, next) => {
  var uri = new MeldaUri(req.params).build("namespace");
  uri = new RegExp("^" + uri + "/[^/]+");

  let query = { uri, public: true };

  query.exclusive = false;

  var projects = await Project.find(query)
    .populate("owner")
    .populate("forkedFrom");

  res.json(projects.map((project) => project.export()));
});

/**
 * Returns the given user's profile.
 */
route.get("/:namespace", async (req, res, next) => {
  var uri = new MeldaUri(req.params).build("namespace");
  var user = await User.findOne({ uri });
  if (!user) {
    return next(new RouteError("User couldn't be found", 404));
  }

  res.json(user.exportPublic());
});

route.get("/set-language/:lang", async (req, res, next) => {
  req.session.language = req.params.lang;
  res.json({success: true, language: req.session.language})
})

module.exports = route
