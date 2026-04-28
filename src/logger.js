const fs = require("fs");
const path = require("path");

const levels = ["debug", "info", "warn", "error"];

function createLogger(options = {}) {
  const logDir = options.logDir || path.join(process.cwd(), "logs");
  const logFile = options.logFile || path.join(logDir, "closetcast.log");
  const minLevel = levels.includes(options.level) ? options.level : "info";

  fs.mkdirSync(logDir, { recursive: true });

  function shouldWrite(level) {
    return levels.indexOf(level) >= levels.indexOf(minLevel);
  }

  function write(level, message, meta) {
    if (!shouldWrite(level)) return;
    const safeMeta = meta ? ` ${JSON.stringify(meta)}` : "";
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${safeMeta}\n`;
    process.stdout.write(line);
    fs.appendFile(logFile, line, (error) => {
      if (error) process.stderr.write(`ClosetCast log write failed: ${error.message}\n`);
    });
  }

  return {
    file: logFile,
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

function redactUrl(value) {
  if (!value || typeof value !== "string") return value;
  return value.replace(/:\/\/([^:@/]+):([^@/]+)@/g, "://$1:****@");
}

module.exports = { createLogger, redactUrl };
