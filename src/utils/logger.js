import winston from 'winston';
import path from 'path';
import config from '../config/env.js';

const logDir = 'logs';

// Define log format for console (with colors for development)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `[${info.timestamp}] ${info.level}: ${info.message}`
  )
);

// Define log format for file (JSON)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const options = {
  // File transport for all levels
  file: {
    level: 'info',
    filename: path.join(logDir, 'app.log'),
    handleExceptions: true,
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  },
  // Console transport
  console: {
    level: 'debug',
    handleExceptions: true,
    // Use simple, colorful format for development, and JSON for production
    format: config.nodeEnv === 'production' 
      ? fileFormat 
      : consoleFormat,
  },
};

const logger = winston.createLogger({
  transports: [
    new winston.transports.File(options.file),
    new winston.transports.Console(options.console),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

// Create a stream object with a 'write' function that will be used by morgan
logger.stream = {
  write: function(message, encoding) {
    logger.info(message.trim());
  },
};

export default logger;