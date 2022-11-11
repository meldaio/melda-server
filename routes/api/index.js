const route = require("express").Router()

route.use(require("./rkb"))
route.use(require("./common"))
route.use(require("./search"))

route.use("/public", require("./public"))
route.use("/cell", require("./cell"))

route.use(require("./auth"))

route.use("/project", require("./project"))
route.use("/category", require("./category"))
route.use("/stage", require("./stage"))
route.use("/user", require("./user"))
route.use("/team", require("./team"))

route.use(require("./kernel"))
route.use("/file", require("./file"))

module.exports = route
