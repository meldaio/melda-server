const route = require("express").Router();
const _ = require("lodash");
const moment = require("moment");
const multer = require("multer");
const { User, Project } = require("../../models");
const RouteError = require("../route-error");
const MeldaUri = require("../../lib/melda-uri");
const path = require("path");

const upload = multer({
  dest: "uploads/users/",
  filename: function (req, file, cb) {
    cb(null, req.session.user._id + path.extname(file.originalname));
  },
});

module.exports = route;
//ADMIN PANEL-start

/* GET ALL USERS */
route.get("/users", async (req, res, next) => {
  // if (!req.session.user.admin) return

  const users = await User.find((err) => {
    if (err) return next(new RouteError("Users couldn't be found", 404));
  });

  res.json(users.map((n) => n.export()));
});

/* GET SINGLE USER BY ID */
route.get("/detail/:id", async (req, res, next) => {
  const user = await User.findOne({ _id: req.params.id }, (err) => {
    if (err) return next(new RouteError("User couldn't be found", 404));
  });

  res.json(user.export());
});

/* UPDATE USER */
route.put("/update/:id", async (req, res, next) => {
  const user = await User.findOne({ _id: req.params.id });
  if (!user) {
    return next(new RouteError("User couldn't be found", 404));
  }
  if(req.body.subscription !== user.subsciption) {
    req.body.subscriptionData = user.subscriptionData;
    req.body.subscriptionData.plan = req.body.subscription;
  }  
  const updatedUser = await User.updateOne(
    { _id: req.params.id },
    req.body,
    { runValidators: true, context: "query" },
    (err) => {
      if (err) {
        if (err.name === "ValidationError") return res.status(409).send(err);

        next(new RouteError("User couldn't be found", 404));
      }
    }
  );

  res.json(updatedUser);
});

/* DELETE USER */
route.delete("/delete/:id", async (req, res, next) => {
  const user = await User.deleteOne({ _id: req.params.id }, (err) => {
    if (err) return next(new RouteError("User couldn't be found", 404));
  });

  res.json(user);
});

/* UPDATE MULTIPLE ISVERIFIED */
route.put("/update-multiple/isVerified", async (req, res, next) => {
  const users = await User.updateMany(
    { _id: { $in: req.body.iDs } },
    { isVerified: req.body.boolValue },
    (err) => {
      if (err) return next(new RouteError("Users couldn't be found", 404));
    }
  );

  res.json(users);
});

/* UPDATE MULTIPLE ADMIN */
route.put("/update-multiple/admin", async (req, res, next) => {
  const users = await User.updateMany(
    { _id: { $in: req.body.iDs } },
    { admin: req.body.boolValue },
    (err) => {
      if (err) return next(new RouteError("Users couldn't be found", 404));
    }
  );

  res.json(users);
});

/* UPDATE MULTIPLE SUBSCRIPTION */
route.put("/update-multiple/subscription", async (req, res, next) => {
  const users = await User.updateMany(
    { _id: { $in: req.body.iDs } },
    { subscription: req.body.numValue },
    (err) => {
      if (err) return next(new RouteError("Users couldn't be found", 404));
    }
  );

  res.json(users);
});

/* DELETE MULTIPLE USERS */
route.post("/delete-multiple", async (req, res, next) => {
  const users = await User.deleteMany({ _id: { $in: req.body } }, (err) => {
    if (err) return next(new RouteError("Users couldn't be found", 404));
  });

  res.json(users);
});

//ADMIN PANEL-end

/**
 * Returns the current loggedin user's credentials
 */
route.get("/", async (req, res, next) => {
  var user = await User.findById(req.session.user._id);

  if (!user) {
    return next(new RouteError("User couldn't be found", 404));
  }

  res.json(user.export());
});

route.post("/", async (req, res, next) => {
  var user = await User.findById(req.session.user._id);
  var fields = ["publicEmail", "bio", "country", "city", "apiKey"];

  if (!user) {
    return next(new RouteError("User couldn't be found", 404));
  }

  fields.forEach((field) => {
    user[field] = req.body[field] || undefined;
  });

  if (typeof user.publicEmail !== "boolean") {
    user.publicEmail = false;
  }

  await user.save();

  req.session.user = user.exportPublic();

  res.json(user.export());
});

route.get("/search", async (req, res, next) => {
  let search = RegExp(req.query.text, "i");
  let page = Number(req.query.page) || 1;
  let listsize = 10;
  let users = await User.find({
    $or: [{ uri: search }, { name: search }, { email: search }],
  })
    .limit(listsize)
    .skip(listsize * (page - 1));

  users = users.map((user) => user.exportPublic());

  res.json(users);
});

/**
 * Handles user photo upload.
 */
route.post("/photo", upload.single("photo"), async (req, res, next) => {
  var user = await User.findById(req.session.user._id);

  if (!user) {
    return next(new RouteError("User couldn't be found", 404));
  }

  user.photo = req.file.filename;
  await user.save();

  req.session.user = user.exportPublic();

  res.json(user.export());
});

/**
 * Handles user photo upload.
 */
route.get("/users", async (req, res, next) => {
  var users = await User.find();
  const output = users.map((user) => user.exportPublic());
  res.json(output);
});
