import fs from 'fs';

const logDir = 'logs';

// Create logs directory if it doesn't exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logFile = fs.createWriteStream(`${logDir}/app.log`, { flags: 'a' });

const log = (level, message, meta = {}) => {
  const logObject = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const logString = JSON.stringify(logObject);
  
  // Write to console
  if (level === 'error') {
    console.error(logString);
  } else {
    console.log(logString);
  }

  // Write to file
  logFile.write(logString + '\n');
};

const logger = {
  info: (message, meta) => log('info', message, meta),
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  debug: (message, meta) => {
    if (process.env.NODE_ENV !== 'production') {
      log('debug', message, meta);
    }
  },
};

export default logger;