const route = require('express').Router()
const { PasswordResetCode, User } = require('../../../models')
const RouteError = require('../../route-error')

route.get('/', async (req, res, next) => {
  const passwordResetCode = await PasswordResetCode.findOne({ code: req.query.code }).populate(
    'user'
  )

  if (!passwordResetCode) {
    return next(new RouteError('Invalid password reset code', 404))
  }

  if (!passwordResetCode.user.isVerified) {
    return next(new RouteError('Account is not verified', 403))
  }

  res.json({ success: true })
})

route.post('/reset', async (req, res, next) => {
  const { newPassword, verifiedNewPassword, code } = req.body

  if (newPassword !== verifiedNewPassword) {
    return next(new RouteError('Passwords not match', 400))
  }

  const passwordResetCode = await PasswordResetCode.findOne({ code }).populate('user')

  if (!passwordResetCode) {
    return next(new RouteError('Code is invalid'), 404)
  }

  const user = passwordResetCode.user

  // We are already validating and hashing the password in pre validate hook in the User model,
  // so no need to check the stuff here...
  user.password = newPassword

  try {
    await user.save()
    await PasswordResetCode.deleteOne(passwordResetCode)
    res.json({ success: true })
  } catch (error) {
    return next(new RouteError('Password is not valid', 400))
  }
})

route.post('/', async (req, res, next) => {
  const { email } = req.body
  const user = await User.findOne({ email })

  if (!user) {
    return next(new RouteError('User is not found', 404))
  }

  if (!user.isVerified) {
    return next(new RouteError('Account is not verified', 403))
  }

  await user.sendPasswordResetEmail()

  res.json({ success: true })
})

module.exports = route
