const route = require("express").Router()

route.use("/user", require("./user"))
route.use("/verify", require("./verify"))
route.use("/password-reset", require("./password-reset"))
route.use("/category", require("./category"))
route.use("/project", require("./project"))

module.exports = route