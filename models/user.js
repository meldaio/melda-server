const path = require('path')
const { mongoose } = require('../lib/mongo')
const { slugify, getNotAllowedNamespaces } = require('../lib/utils')
const passwordValidator = require('password-validator')
const { isEmail } = require('validator')
const bcrypt = require('bcrypt')
const { VerificationCode } = require('./verification-code')
const { PasswordResetCode } = require('./password-reset-code')
const { sendEmail } = require('../lib/email')
const uniqueValidator = require('mongoose-unique-validator')

const host = process.env.BASE

const passwordSchema = new passwordValidator()
  .is()
  .min(8) // Minimum length 8
  .is()
  .max(255) // Maximum length 100
  .has()
  .letters() // Must have letters
  .has()
  .digits() // Must have digits

const userSchema = new mongoose.Schema({ // m_username ve m_password eklenecek.
  uri: {
    type: String,
    required: [true, 'uri is a required field'],
    unique: true,
  },

  id: {
    type: String,
    required: false,
  },

  name: {
    type: String,
    required: [true, 'name is a required field'],
    maxlength: 255,
  },

  email: {
    required: [true, 'email is a required field'],
    type: String,
    unique: true,
    validate: value => isEmail(value),
  },

  password: {
    type: String,
  },

  newsletter: {
    required: [true, 'newsletter is a required field'],
    type: Boolean,
    default: false,
  },

  isVerified: {
    type: Boolean,
    required: [true, 'isVerified is a required field'],
    default: false,
  },

  photo: {
    type: String,
  },

  publicEmail: {
    type: Boolean,
    required: [true, 'IsVerified is a required field'],
    default: false,
  },

  lastLogin: {
    type: Date,
    required: [true, 'lastLogin is a required field'],
    default: Date.now
  },

  bio: {
    type: String,
  },

  country: {
    type: String,
  },

  city: {
    type: String,
  },

  admin: {
    type: Boolean,
    default: false,
  },

  type: {
    type: String,
    enum: ['normal', 'patron'],
    default: 'normal',
    required: [true, 'type is a required field'],
  },

  subscription: {
    type: String,
    required: [true, 'subscription is a required field'],
    default: '1',
    enum: ['1', '2', '3', '4', '5'],
  },

  subscriptionData: {
    plan: {
      // same as user.subscription
      type: String,
      required: [true, 'plan is a required field'],
      default: '1',
      enum: ['1', '2', '3', '4', '5'],
    },

    currency: { type: String, enum: ['try', 'usd'] },

    initialized: { type: Boolean },
    referenceCode: { type: String },

    customerDataIsSync: { type: Boolean },
    customerReferenceCode: { type: String },

    name: { type: String },
    surname: { type: String },
    identity: { type: String },
    email: { type: String },
    phone: { type: String },
    city: { type: String },
    country: { type: String },
    address: { type: String },

    paymentCardName: { type: String },
    paymentCardBrand: { type: String },

    /*
    ucsToken: { type: String },
    cardToken: { type: String },
    consumerToken: { type: String },
    */
  },

  provider: {
    type: String,
  },
  gender: {
    type: String,
  },
  birthDate: {
    type: Date,
  },
  phone: {
    type: String,
  },
  privacy: {
    type: String,
    default: 'Public',
  },
  socialAccounts: [
    {
      name: String,
      url: String,
    },
  ],
  interest: [
    {
      type: String,
    },
  ],
  deleted: {
    type: Date,
  },
  suspended: {
    type: Boolean,
  },

  artifactsToken: {
    type: String,
  },

  artifactsAuthCode: {
    type: String,
  },

  apiKey: {
    type: String,
  },

  m_userName: {
    type: String,
  },

  m_password: {
    type: String,
  },
  m_id: {
    type: Number,
  },
})

userSchema.plugin(uniqueValidator, { message: 'already exists' })

userSchema.pre('validate', async function (next) {
  var self = this.model('User')

  // WARNING!: FOR THE USER MIGRATIONS THIS BLOCK IS COMMENTED OUT!
  //           DONT FORGET TO REVERSE IT AFTER MIGRATION!
  if (this.isModified('password')) {
    if (this.password && !passwordSchema.validate(this.password)) {
      throw new Error('Password is not strong enough')
    }

    this.password = await bcrypt.hash(this.password, 10)
  }

  if (this.isNew) {
    this.uri = await self.finduri(this.name)
  }

  next()
})

userSchema.methods.sendVerificationEmail = async function () {
  const code = await VerificationCode.generateVerificationCode(this)
  const url = `${host}verify?code=${code}`
  await sendEmail('AccountVerification', { name: this.name, url }, [this.email])
}

userSchema.methods.sendPasswordResetEmail = async function () {
  const code = await PasswordResetCode.generatePasswordResetCode(this)
  const url = `${host}reset-password?code=${code}`
  await sendEmail('AccountPasswordReset', { name: this.name, url }, [this.email])
}

userSchema.methods.export = function () {
  var user = this.toJSON()

  delete user.__v
  delete user.id
  delete user.subscriptionData
  delete user.password

  if (!user.admin) {
    delete user.admin
  }

  return user
}

userSchema.methods.exportPublic = function () {
  var user = this.export()

  delete user.suspended
  delete user.deleted
  delete user.interest
  delete user.socialAccounts
  delete user.privacy
  delete user.phone
  delete user.birthDate
  delete user.gender
  delete user.provider
  delete user.type
  delete user.publicEmail
  delete user.artifactsToken
  delete user.artifactsAuthCode
  delete user.subscriptionData
  delete user.apiKey
  delete user.password
  delete user.newsletter

  if (!this.publicEmail) {
    delete user.email
  }

  return user
}

userSchema.statics.authenticate = async function(email, password) {
  const user = await this.model('User').findOne({ email })

  if (!user) {
    return false
  }

  if (!await bcrypt.compare(password, user.password)) {
    return false
  }

  user.lastLogin = new Date()
  
  return await user.save()
}

userSchema.statics.finduri = async function (text, id, number = 0) {
  var suffix = number ? '-' + number : ''
  var uri = slugify(text + suffix)
  var query = { uri }

  if (id) {
    query._id = { $ne: mongoose.Types.ObjectId(id) }
  }

  var record = await this.findOne(query)

  const notAllowedNamespaces = getNotAllowedNamespaces()

  if (!record && !notAllowedNamespaces.includes(uri)) {
    return uri
  }

  return await this.finduri(text, id, ++number)
}

const User = mongoose.model('User', userSchema)


module.exports = { schema: userSchema, User }
