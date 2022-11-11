const mongoose = require('mongoose');
const ENV = process.env;

let url = ENV.MONGODB_HOST || "localhost";

module.exports = { mongoose, url, registerModel };

mongoose.Promise = global.Promise;

if (ENV.MONGODB_USERNAME && ENV.MONGODB_PASSWORD) {
	url = ENV.MONGODB_USERNAME + ":" + ENV.MONGODB_PASSWORD + "@" + url;
}

if (ENV.MONGODB_PORT) {
	url += ":" + ENV.MONGODB_PORT;
}

url = "mongodb://" + url + "/" + (ENV.MONGODB_DATABASE || "visualr");

mongoose.connect(url, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
mongoose.connection.on('connected', function () {
  console.info('Mongoose connected');
});

// If the connection throws an error
mongoose.connection.on('error',function (err) {
  console.error('Mongoose default connection error: ' + err);
});

// When the connection is disconnected
mongoose.connection.on('disconnected', function () {
  console.warn('Mongoose default connection disconnected');
});

mongoose.set('useCreateIndex', true);

function registerModel(Cl) {
  const noop = new Cl;
  const name = Cl.name;
  const hooks = { pre: noop._pre || {}, post: noop._post || {} }
  let schema = {};

  Object.getOwnPropertyNames(noop)
    .filter(field => !["_pre", "_post"].includes(field))
    .forEach(field => schema[field] = noop[field]);

  schema = new mongoose.Schema(schema);

  for (let hookName in hooks) {
    for (let hookType in hooks[hookName]) {
      schema[hookName](hookType, hooks[hookName][hookType]);
    }
  }

  schema.loadClass(Cl);

  const model = mongoose.model(name, schema);

  return { [name]: model, schema };
}