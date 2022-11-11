const { mongoose } = require('../lib/mongo')
const crypto = require('crypto')

const schema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
  },

  createdAt: {
    type: Date,
    required: true,
    default: Date.now,
    expires: 3600, // 1 hour
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
})

schema.statics.generatePasswordResetCode = async user => {
  const code = crypto.randomBytes(16).toString('hex')
  await PasswordResetCode.create({ code, user })
  return code
}

const PasswordResetCode = mongoose.model('PasswordResetCode', schema)

module.exports = { PasswordResetCode, schema }
