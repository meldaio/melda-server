const fs = require("fs")
const path = require("path")
const EventEmitter = require("events");

const logEmitter = new EventEmitter;

// Clear old logs
fs.writeFileSync("logs/stdout.log", "")
fs.writeFileSync("logs/stderr.log", "")

const out = fs.createWriteStream("logs/stdout.log")
const err = fs.createWriteStream("logs/stderr.log")

// This doesn't working
// process.stdout.pipe(output);
// process.stderr.pipe(errOutput);

require("console-stamp")(console, { pattern: "dd.mm.yyyy HH:MM:ss.l" })

// Backups of originals
const writeOut = process.stdout.write
const writeErr = process.stderr.write

process.stdout.write = function(...args) {
	writeOut.apply(process.stdout, args)
	out.write.apply(out, args)
  logEmitter.emit("write", "stdout", ...args)
  logEmitter.emit("stdout", ...args)
}

process.stderr.write = function(...args) {
	writeErr.apply(process.stderr, args)
	err.write.apply(err, args)
  logEmitter.emit("write", "stderr", ...args)
  logEmitter.emit("stderr", ...args)
}


module.exports =  {
  logEmitter
}