const { mongoose } = require("../lib/mongo");
const { slugify, getNotAllowedNamespaces } = require("../lib/utils");
const ObjectId = mongoose.Schema.Types.ObjectId;

const host = process.env.BASE;

const teamSchema = new mongoose.Schema({
  uri: {
    type: String,
    required: true,
    unique: true,
  },

  modified: {
    type: Date,
    required: true,
  },

  created: {
    type: Date,
    required: true,
    default: Date.now,
  },

  title: {
    type: String,
    required: true,
  },

  owner: {
    ownerId: { type: ObjectId, ref: "User", required: true },
    role: { type: String, default: "Owner" },
  },

  members: [
    {
      userId: { type: ObjectId, ref: "User", required: true },
      role: { type: String, default: "Member" },
    },
  ],

  pendingMembers: [
    {
      email: String,
      role: { type: String, default: "Member" },
    },
  ],

  projects: [
    {
      type: ObjectId,
      ref: "Project",
    },
  ],

  meetings: [
    {
      meetingID: { type: String, required: true },
      recording: {
        type: Boolean,
        required: true,
        default: false,
      },
      recordings: { type: Array, required: false },
      startDate: {
        type: Date,
        required: true,
        default: Date.now,
      },
      endDate: {
        type: Date,
        required: true,
        default: Date.now,
      },
      createDate: {
        type: Date,
        required: true,
        default: Date.now,
      },
      meetingInfo: {
        type: Object,
        required: true,
      },
      scores: {
        type: Object,
        required: false
      }
    },
  ],

  m_id: {
    type: Number,
  },
});

teamSchema.pre("validate", async function (next) {
  const self = this.model("Team");
  const User = this.model("User");

  let ownerId = this.owner.ownerId;
  let user;

  if (!(ownerId instanceof User)) {
    user = await User.findById(ownerId);
  }

  this.uri = await self.finduri(this.title, user.uri);

  if (this.isNew) {
    const owner = {
      userId: this.owner.ownerId,
      role: this.owner.role,
    };
    this.members.push(owner);
    this.modified = Date.now();
  }

  next();
});

teamSchema.pre("save", async function (next) {
  this.changedPaths = this.modifiedPaths();

  if (this.changedPaths.length) {
    this.modified = Date.now();
  }

  next();
});

teamSchema.statics.finduri = async function (text, user, id, number = 0) {
  if (typeof user === "object") {
    user = user.uri;
  }

  const suffix = number ? "-" + number : "";
  const uri = user + "/" + "class" + "/" + slugify(text + suffix);
  let query = { uri };

  if (id) {
    query._id = { $ne: mongoose.Types.ObjectId(id) };
  }

  const notAllowedNamespaces = getNotAllowedNamespaces();

  const record = await this.findOne(query);

  if (!record && !notAllowedNamespaces.includes(uri)) {
    return uri;
  }

  return await this.finduri(text, user, id, ++number);
};

teamSchema.methods.export = function () {
  let team = this.toJSON();

  delete team.__v;
  delete team._id;
  delete team.owner;
  delete team.pendingMembers;

  return team;
};

const Team = mongoose.model("Team", teamSchema);

module.exports = { Team, teamSchema };
