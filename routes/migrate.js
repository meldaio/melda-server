const route = require("express").Router();
const { Project, Stage, Cell, User } = require("../models")
const mongoose = require("mongoose")

module.exports = route

// to 0.10.0
route.get("/0-10-0", async (req, res, next) => {
  /**
   * DROP INDEXES
   * 
   */

  /**
   * Fix Users
   */
  var users = await User.find({})

  for (let i = 0; i < users.length; i++) {
    let user = users[i]

    // Remove photo to download it again when signing in first time
    user.photo = undefined

    // Create uri
    user.uri = await User.finduri(user.name)

    await user.save()
  }


  /**
   * Fix projects
   */
  var projects = await Project.find({}).populate("owner")

  for (let i = 0; i < projects.length; i++) {
    let project = projects[i]

    if ( ! project.owner ) {
      await project.remove()
      continue
    }

    // Create uri
    project.uri = await Project.finduri(
      project.title,
      project.owner.uri
    )

    await project.save()
  }

  /**
   * Fix Stages
   */
  var stages = await Stage.find({}).populate("project")

  for (let i = 0; i < stages.length; i++) {
    let stage = stages[i]

    if ( ! stage.project ) {
      await stage.remove()
      continue
    }

    // Create uri
    stage.uri = await Stage.finduri(
      stage.title,
      stage.project.uri
    )

    await stage.save()
  }


  res.send("OK")
})


route.get("/0-11-0", async (req, res, next) => {
  // Add exclusive field to all current projects
  var projects = await Project.find({}).populate("owner")

  for (let i = 0; i < projects.length; i++) {
    let project = projects[i]

    if ( ! project.owner ) {
      await project.remove()
      continue
    }

    project.exclusive = false
    await project.save()
  }

  res.send("OK")
})


route.get("/0-14-0", async (req, res, next) => {
  let cells = await Cell.find({
    $or: [{ language: "Markdown" }, { language: "HTML" }]
  })

  for (let i = 0; i < cells.length; i++) {
    let cell = cells[i]

    cell.isMarkup = true
    cell.hiddenOutput = false
    cell.hiddenCode = false
    cell.dontEvaluate = false
    await cell.save()
  }

  res.send("OK ("+ cells.length +" cells)")
})


route.get("/fix-suleyman", async (req, res, next) => {
  let suleymanFromPranageo = await User.findOne({ email: "suleyman@pranageo.com" })
  let suleymanFromGithub = await User.findOne({ email: "sl.taspinar@gmail.com" })

  suleymanFromGithub.id = suleymanFromPranageo.id
  suleymanFromGithub.email = "suleyman@pranageo.com"
  suleymanFromGithub.admin = true
  suleymanFromGithub.provider = "pranageo"

  await suleymanFromPranageo.remove()
  await suleymanFromGithub.save()
})

route.get("/fix-ratings", async (req, res, next) => {
  let projects = await Project.find({});

  for (let i = 0; i < projects.length; i++) {
    let project = projects[i];
    project.rating = undefined;
    await project.save();
  }

  res.send("OK");
})

route.get("/fix-published-projects", async (req, res, next) => {
  let projects = await Project.find({});

  for (let i = 0; i < projects.length; i++) {
    let project = projects[i];

    // https://stackoverflow.com/a/6938733
    project.category = undefined
    project.publishUri = undefined
    project.publishMeta = undefined
    
    await project.save();
  }

  res.send("OK");
})


route.get("/fix-suleyman-dev-books", async (req, res, next) => {
  // !! ONLY FOR DEV !!
  let p1 = await Project.findOne({ uri: 'suley/tidy-text-mining' })
  let p2 = await Project.findOne({ uri: 'suley/data-science-live-book' })

  p1.published = true
  p2.published = true
    
  await p1.save();
  await p2.save()

  res.send("OK");
})

route.get("/fix-user-subscription-field", async (req, res, next) => {
  let users = await User.find({});
  for (let i = 0; i < users.length; i++) {
    let user = users[i];
    user.subscription = "1";
    await user.save();
  }
  res.send("OK");
})


route.get("/fix-exclusive-projects-forkable-field", async (req, res, next) => {
  let projects = await Project.find({});

  for (let i = 0; i < projects.length; i++) {
    let project = projects[i];

    project.forkable = true
    
    await project.save();
  }

  res.send("OK");
})

route.get("/migrate-users", async (req, res, next) => {
  const pranageoUsers = require("../exported-users.json")

  for (let i = 0; i < pranageoUsers.length; i++) {
    let pranageoUser = pranageoUsers[i]
    let meldaUser = await User.findOne({ email: pranageoUser.email })

    if (meldaUser) {
      if (meldaUser.provider) {
        if (meldaUser.provider !== 'patreon' || meldaUser.provider !== 'github') {
          meldaUser.password = pranageoUser.password
          meldaUser.isVerified = pranageoUser.isVerified
        }
      } else {
        meldaUser.password = pranageoUser.password
        meldaUser.isVerified = pranageoUser.isVerified
      }

      await meldaUser.save()
    }
  }
  res.send('OK')
})


route.get("/remove-duplicate-users", async (req, res) => {
  let users = await User.find({});
  let uniqueUsers = [];
  console.log("TESTTTT")
  users.map(async user => {
    if (uniqueUsers.indexOf(user.email) === -1 && user.isVerified) {
      uniqueUsers.push(user.email);
    } else {
      await User.findByIdAndDelete(user._id)
      console.log(user.email, "is deleted");
    }
  });

  await User.syncIndexes()
  res.send(`${users.length - uniqueUsers.length} users deleted`);
});


route.get("/drop-test-db", async(req, res) => {
  if(process.env.NODE_ENV !== "test") return res.send("OK");

  for (let collection in mongoose.connection.collections) {
    mongoose.connection.collections[ collection ]
      .deleteMany({}, (err) => {
        if (err) return res.send(err);
      })
  }

  res.send("OK");
})
