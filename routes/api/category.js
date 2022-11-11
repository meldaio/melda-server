const multer = require('multer')
const route = require('express').Router()
const RouteError = require('../route-error')
const { promisify } = require('util')
const fs = require('fs')
const { Category } = require('../../models/category')

const CATEGORY_THUMBNAIL_UPLOADS_PATH = 'uploads/category/'

const thumbnailUpload = multer({
  storage: multer.diskStorage({
    destination: CATEGORY_THUMBNAIL_UPLOADS_PATH,
    filename: function (req, file, cb) {
      cb(null, Date.now() + file.originalname + '.png')
    },
  }),
})

/**
 * Creates a new category
 */
route.post('/', thumbnailUpload.single('thumbnail'), async (req, res, next) => {
  let { name, description, priority, redirectUri, tags, parent } = req.body

  priority = JSON.parse(priority)
  tags = JSON.parse(tags)

  if (!req.session.user.admin) {
    return next(new RouteError("You don't have access rights", 401))
  }

  if (await Category.findOne({ name })) {
    return next(new RouteError('Category name is already exist', 400))
  }

  if (parent === name) {
    return next(new RouteError('Initial category can not be a parent category', 400))
  }

  const category = new Category()

  category.slug = await Category.findSlug(name)
  category.name = name
  category.description = description
  category.redirectUri = redirectUri
  category.priority = priority
  category.parent = await Category.findOne({ name: parent })
  category.tags = tags
  category.thumbnail = req.file.filename

  await category.save()

  res.json(category)
})

/**
 * Updates an existed category
 */
route.patch('/:category', thumbnailUpload.single('thumbnail'), async (req, res, next) => {
  let { 
    name, description, tags, parent, priority, redirectUri, 
    showTitle,showDescription,showViews, showTags,showPublication,showModification 
  } = req.body
  const category = await Category.findOne({ slug: req.params.category })

  priority = JSON.parse(priority)
  tags = JSON.parse(tags)

  if (!req.session.user.admin) {
    return next(new RouteError("You don't have access rights", 401))
  }

  if (!category) {
    return next(new RouteError('Category is not found', 404))
  }

  if (parent === name) {
    return next(new RouteError('Initial category can not be a parent category', 400))
  }

  if (category.name !== name && (await Category.findOne({ name }))) {
    return next(new RouteError('Category name is already exist', 400))
  }

  category.slug = category.name !== name ? await Category.findSlug(name) : category.slug
  category.name = name
  category.description = description
  category.redirectUri = redirectUri
  category.priority = priority
  category.showTitle = showTitle
  category.showDescription = showDescription
  category.showViews = showViews
  category.showTags = showTags
  category.showPublication = showPublication
  category.showModification = showModification
  category.tags = tags
  category.parent = await Category.findOne({ name: parent })

  if (req.file) {
    // Delete current thumbnail before update
    const unlinkAsync = promisify(fs.unlink)
    const filePath = CATEGORY_THUMBNAIL_UPLOADS_PATH + category.thumbnail
    try {
      await unlinkAsync(filePath)
    } catch (e) {}

    category.thumbnail = req.file.filename
  }

  await category.save()

  res.json(category)
})

/**
 * Deletes an existed category
 */
route.delete('/:category', async (req, res, next) => {
  const category = await Category.findOne({ slug: req.params.category })

  if (!req.session.user.admin) {
    return next(new RouteError("You don't have access rights", 401))
  }

  if (!category) {
    return next(new RouteError('Category is not found', 404))
  }

  await category.remove()

  // Delete category thumbnail as well
  const unlinkAsync = promisify(fs.unlink)
  const filePath = CATEGORY_THUMBNAIL_UPLOADS_PATH + category.thumbnail
  try {
    await unlinkAsync(filePath)
  } catch (e) {}

  res.json({ success: true })
})

module.exports = route
