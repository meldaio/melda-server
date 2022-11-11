const EventEmitter = require("events");

class ClassManagerError extends Error {}

class ClassManager extends EventEmitter {
  startMeeting(params) {
    console.log(params, "Meeting started");
  }
  stopMeeting(params) {
    console.log(params, "Meeting stopped");
  }
  isInitialized(id) {
    return !!id;
  }
}

module.exports = new ClassManager();