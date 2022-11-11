const route = require("express").Router()
const { VerificationCode } = require("../../../models")
const RouteError = require("../../route-error")

route.get("/", async (req, res, next) => {
  const verificationCode = await VerificationCode.findOne({ code: req.query.code }).populate("user")

  if (!verificationCode) {
    return next(new RouteError('Invalid verification code', 404))
  }

  verificationCode.user.isVerified = true

  const { name, isVerified } = await verificationCode.user.save()

  await VerificationCode.deleteOne(verificationCode)

  res.json({ name, isVerified })
})

module.exports = route