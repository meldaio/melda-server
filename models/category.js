const { mongoose } = require('../lib/mongo')
const { slugify } = require('../lib/utils')

const schema = new mongoose.Schema({
  /**
   * Unique category slug.
   * @type {String}
   */
  slug: { type: String, required: true, unique: true },

  /**
   * Unique category name.
   * @type {String}
   */
  name: { type: String, required: true, unique: true },

  /**
   * Description text about this category.
   * @type {String}
   */
  description: { type: String },

  /**
   * Priority that affects the appearing order of the category
   * in a view.
   * @type {Number}
   */
  priority: { type: Number, required: true, default: 0 },

  /**
   * Display title option for category page
   * @type {Boolean}
   */
  showTitle: { type: Boolean, required: true, default: true },

    /**
   * Display description option for category page
   * @type {Boolean}
   */
  showDescription: { type: Boolean, required: true, default: true },

  /**
   * Display tags option for category page
   * @type {Boolean}
   */
  showTags: { type: Boolean, required: true, default: true },

  /**
   * Display views option for category page
   * @type {Boolean}
   */
  showViews: { type: Boolean, required: true, default: true },

  /**
   * Display publication date option for category page
   * @type {Boolean}
   */
  showPublication: { type: Boolean, required: true, default: true },

  /**
   * Display modification date option for category page
   * @type {Boolean}
   */
  showModification: { type: Boolean, required: true, default: true },
  
  /**
   * Array of tag strings.
   * @type {Array}
   */
  tags: [String],

  /**
   * Thumbnail of the category.
   * @type {String}
   */
  thumbnail: { type: String, required: true },

  /**
   * Parent category
   * @type {ObjectId}
   */
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },

  /**
   * Redirect uri
   * @type {String}
   */
  redirectUri: { type: String }
})

schema.pre('remove', async function () {
  const categories = await this.model('Category').find({ parent: this._id })

  categories.forEach(category => {
    category.parent = null
    category.save()
  })
})

schema.statics.findSlug = async function (name, count = 0) {
  var suffix = count ? '-' + count : ''
  var slug = slugify(name + suffix)

  var category = await this.findOne({ slug })

  return !category ? slug : await this.findSlug(name, ++count)
}

const Category = mongoose.model('Category', schema)

module.exports = { Category, schema }
