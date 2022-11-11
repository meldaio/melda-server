"use strict"

const route = require("express").Router()
const Kernel = require("../../lib/kernel")

route.get("/available-kernels", (req, res, next) => {
  res.json(Kernel.all())
})

module.exports = route