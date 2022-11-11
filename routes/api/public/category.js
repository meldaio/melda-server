const route = require('express').Router()
const RouteError = require('../../route-error')
const { Category } = require('../../../models/category')

/**
 * Gets all categories
 */
route.get('/', async (req, res, next) => {
  const categories = await Category.find().populate('parent')
  res.json({ categories })
})

/**
 * Gets a category
 */
route.get('/:category', async (req, res, next) => {
  const category = await Category.findOne({ slug: req.params.category }).populate('parent')
  res.json(category)
})

route.get('/:category/children', async (req, res, next) => {
  const category = await Category.findOne({ slug: req.params.category })

  if (!category) {
    return next(new RouteError('Category is not found', 404))
  }

  const subCategories = await Category.find({ parent: category._id })

  res.json({ subCategories })
})
module.exports = route