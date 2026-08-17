const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.join(process.env.APPDATA || '.', 'TriumphAutoreg', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      maxsize: 10485760,
      maxFiles: 5,
      tailable: true
    })
  ]
});

module.exports = { logger };