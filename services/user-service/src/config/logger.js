'use strict';

const winston = require('winston');

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'user-service',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  },
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'ISO' }),
    json()
  ),
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? combine(errors({ stack: true }), timestamp(), json())
        : combine(colorize(), simple()),
    }),
  ],
  exitOnError: false,
});

// Add fatal level helper
logger.fatal = (meta, message) => logger.error({ ...meta, fatal: true }, message);

module.exports = logger;
