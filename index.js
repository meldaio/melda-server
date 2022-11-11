require("./lib/log");
require("dotenv").config();

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const RouteError = require("./routes/route-error.js");
const cors = require('cors');
const { PORT, CLIENT_PATH } = process.env;
const server = app.listen(PORT, () => console.info('Listening on', PORT));
const socket = require("./sockets");
const { isValidHttpStatusCode } = require("./lib/utils");
const path = require('path')
const sessionParser = require('./lib/session-parser')

const clientPath = path.resolve(CLIENT_PATH)

app.use(sessionParser)
socket.init(server);

app.set('view engine', 'pug');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

app.use("/api/migrate", require("./routes/migrate"));
app.use("/api/photo", express.static('uploads/users'), notFound);
app.use("/api/thumbnail/category", express.static('uploads/category'), notFound);
app.use("/api/thumbnail", express.static('uploads/projects'), notFound);
app.use("/api/images", express.static(clientPath + '/src/images'), notFound);
app.use("/api", require("./routes/api"));
//app.use("/public-api", require("./routes/public-api"))

app.use(require("./routes/client"))

app.use((err, req, res, next) => {
  var genericMessage = "Server error";

  var status = Number(err.status) || 500;
  var message = err.message || genericMessage;
  let type = err.type || 'Error';

  if (process.env.NODE_ENV !== 'development' && !(err instanceof RouteError)) {
    message = genericMessage;
    status = 500;
    type = 'Error';
  }

  if ( ! isValidHttpStatusCode(status) ) {
  	status = 500;
  }

  if (err.status !== 404) {
    console.error(err);
  }
  res.status(status).json({ message, type });
})


function notFound(req, res, next) {
  next(new RouteError("File not found", 404));
}
