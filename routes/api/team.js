const route = require("express").Router();
const _ = require("lodash");
const { User, Project } = require("../../models");
const { Team } = require("../../models/team");
const RouteError = require("../route-error");
const FormData = require("form-data");
const Axios = require("axios");

module.exports = route;

/**
 * Create Team
 */
route.post("/", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  if (!req.body.title) {
    return next(new RouteError("Team name can not be empty", 400));
  }

  if (req.body.title.length > 60) {
    return next(new RouteError("Team name must be at most 60 characters", 400));
  }

  const regex =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

  req.body.pendingMembers.forEach((member) => {
    if (!member.email) {
      return next(new RouteError("Email can not be empty", 400));
    }

    if (!member.role) {
      return next(new RouteError("Role can not be empty", 400));
    }

    if (!regex.test(String(member.email).toLowerCase())) {
      return next(new RouteError(`${member.email} is not a valid email`, 400));
    }
  });

  let team = new Team();

  team.title = req.body.title;
  team.owner.ownerId = req.session.user._id;
  team.pendingMembers = req.body.pendingMembers;

  await Team.create(team);

  await team.save();

  res.json(team.export());
});

/**
 * Edit Team
 */
route.put("/", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  if (!req.body.title) {
    return next(new RouteError("Team name can not be empty", 400));
  }

  if (req.body.title.length > 60) {
    return next(new RouteError("Team name must be at most 60 characters", 400));
  }

  const regex =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

  req.body.pendingMembers.forEach((member) => {
    if (!member.email) {
      return next(new RouteError("Email can not be empty", 400));
    }

    if (!member.role) {
      return next(new RouteError("Role can not be empty", 400));
    }

    if (!regex.test(String(member.email).toLowerCase())) {
      return next(new RouteError(`${member.email} is not a valid email`, 400));
    }
  });

  let team = await Team.findOne({ uri: req.query.uri });

  if (!team) {
    return next(new RouteError("Team not found", 404));
  }

  if (req.body.title !== team.title) {
    team.uri = await Team.finduri(req.body.title, req.session.user, team._id);
    team.title = req.body.title;
  }

  const reqMemberEmails = req.body.members.map((n) => n.email);
  const users = await User.find({ email: { $in: reqMemberEmails } });
  const memberIds = users.map((n) => n._id.toString());

  team.pendingMembers = req.body.pendingMembers;
  team.members = team.members.filter((n) =>
    memberIds.includes(n.userId.toString())
  );

  team.members.forEach((n) => {
    const user = users.find((m) => m._id.toString() === n.userId.toString());
    const member = req.body.members.find((k) => k.email === user.email);
    n.role = member.role;
  });

  await Team.findByIdAndUpdate(team._id, team);
  res.json(team.export());
});

/**
 * Delete Team
 */
route.delete("/", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  let team = await Team.findOne({ uri: req.query.uri });

  if (!team) {
    return next(new RouteError("Team not found", 404));
  }

  if (team.owner.ownerId.toString() !== req.session.user._id.toString()) {
    return next(new RouteError("You don't have permission to delete", 401));
  }

  const response = await Team.findByIdAndDelete(team._id);
  res.send("test");
});

/**
 * Returns teams where user is member of
 */
route.get("/list", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const response = await Team.find({
    members: { $elemMatch: { userId: { $in: req.session.user._id } } },
  });

  let data = [];
  for (let i in response) {
    let row = response[i];
    let owner = await User.findById(row.owner.ownerId);
    const teamData = row.export();
    teamData.ownerData = owner.exportPublic();
    teamData.ownerId = row.owner.ownerId;
    data.push(teamData);
  }

  res.send(data);
});

/**
 * Returns pending teams for user
 */
route.get("/list-pending", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }
  let user = await User.findById(req.session.user._id);
  let email = user.email;
  const documents = await Team.find({
    pendingMembers: { $elemMatch: { email } },
  });

  let data = [];
  documents.forEach((document) => {
    const teamData = {
      title: document.title,
      uri: document.uri,
      modified: document.modified,
      ownerId: document.owner.ownerId,
    };
    data.push(teamData);
  });

  res.send(data);
});

/**
 * Returns team members and pending members
 */
route.get("/members", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const team = await Team.findOne({ uri: req.query.uri });

  if (!team) {
    return next(new RouteError("Team not found", 404));
  }

  const userIds = team.members.map((n) => n.userId);
  const users = await User.find({ _id: { $in: userIds } });

  if (!users) {
    return next(new RouteError("Members not found", 404));
  }

  let teamMembers = [];
  users.forEach((m) => {
    const role = team.members.find(
      (n) => n.userId.toString() === m._id.toString()
    ).role;

    const member = {
      name: m.name,
      email: m.email,
      uri: m.uri,
      role: role,
    };

    teamMembers.push(member);
  });

  //Puts owner as the first element of the array
  let ownerMember = teamMembers.filter((n) => n.role === "Owner");
  ownerMember = ownerMember[0];
  teamMembers = teamMembers.filter((n) => n.role !== "Owner");
  teamMembers.unshift(ownerMember);

  const data = {
    members: teamMembers,
    pendingMembers: team.pendingMembers,
  };

  res.json(data);
});

/**
 * Adds project to team
 */
route.patch("/project", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const project = await Project.findById(req.body.projectId);

  if (!project) {
    return next(new RouteError("Project not found", 404));
  }

  const team = await Team.findOne({ uri: req.body.teamUri });

  if (!team) {
    return next(new RouteError("Team not found", 404));
  }

  if (team.projects.includes(project._id)) {
    return next(new RouteError("Project already exists in the team", 401));
  }

  const filter = { uri: req.body.teamUri };
  const update = { $push: { projects: req.body.projectId } };
  const result = await Team.findOneAndUpdate(filter, update, {
    new: true,
  });
  project.team = team;
  project.save();

  res.json(result.export());
});

/**
 * Accept team invitation
 */
route.patch("/accept", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }
  const team = await Team.findOne({ uri: req.body.teamUri });
  const user = await User.findById(req.session.user._id);

  if (!team) {
    return next(new RouteError("Team not found", 404));
  }
  let role = "";
  for (let i = 0; i < team.pendingMembers.length; i++) {
    const element = team.pendingMembers[i];
    if ((element.email = user.email)) {
      role = element.role;
    }
  }
  member = {
    userId: req.session.user._id,
    role,
  };
  const filter = { uri: req.body.teamUri };
  await Team.findOneAndUpdate(
    filter,
    { $push: { members: member } },
    {
      new: true,
    }
  );
  const result = await Team.findOneAndUpdate(filter, {
    $pull: { pendingMembers: { email: user.email } },
  });
  res.json(result.export());
});

/**
 * Decline team invitation
 */
route.patch("/decline", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }
  const team = await Team.findOne({ uri: req.body.teamUri });
  const user = await User.findById(req.session.user._id);

  if (!team) {
    return next(new RouteError("Team not found", 404));
  }

  const result = await Team.findOneAndUpdate(
    { uri: req.body.teamUri },
    { $pull: { pendingMembers: { email: user.email } } }
  );
  res.json(result.export());
});
/**
 * Get Team
 */
route.get("/meeting/:namespace/:title/:id", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const uri = req.params.namespace + "/class/" + req.params.title;
  const team = await Team.findOne({ uri: { $eq: uri } });

  res.json(_.find(team.meetings, {meetingID: req.params.id}));
});

route.get("/score/:namespace/:title", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const uri = req.params.namespace + "/class/" + req.params.title;
  const team = await Team.findOne({ uri: { $eq: uri } });
  const response = await Axios.get(`${process.env.RMD_CONVERTER_URL}/score?class_name=${encodeURIComponent(team.title)}`)
  res.json({ data: response.data || true });
});

/**
 * Get Team
 */
route.get("/meetings/:namespace/:title", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const uri = req.params.namespace + "/class/" + req.params.title;
  const team = await Team.findOne({ uri: { $eq: uri } });

  res.json(team.meetings);
});
/**
 * Get Team
 */
route.get("/:namespace/:title", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const uri = req.params.namespace + "/class/" + req.params.title;
  const team = await Team.findOne({ uri: { $eq: uri } });

  res.json(team);
});

/**
 * Delete project from team
 */
route.patch("/delete/:projectId", async (req, res, next) => {
  if (!req.session.user) {
    return next(new RouteError("You don't have access rights", 401));
  }

  const filter = { projects: { $in: req.params.projectId } };
  const update = { $pull: { projects: req.params.projectId } };
  const team = await Team.findOneAndUpdate(filter, update);

  res.json({ success: true });
});

/**
 * Leave team
 */
route.patch("/leave-classroom", async(req, res, next) => {
  const team = await Team.findOne({ uri: req.body.teamUri });
  const user = await User.findById(req.session.user._id);

  if (!team) {
    return next(new RouteError("Team not found", 404));
  }
  await Team.findOneAndUpdate(
    { uri: req.body.teamUri },
    { $pull: { members: { userId: user._id } } }
  );
  res.json({success: true});
})

