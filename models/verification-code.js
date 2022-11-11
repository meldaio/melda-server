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
    expires: 43200, // 12 hours
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
})

schema.statics.generateVerificationCode = async user => {
  const code = crypto.randomBytes(16).toString('hex')
  await VerificationCode.create({ code, user })
  return code
}

const VerificationCode = mongoose.model('VerificationCode', schema)

module.exports = { VerificationCode, schema }
