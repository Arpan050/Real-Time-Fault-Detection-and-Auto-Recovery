'use strict';

const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

const requestLogger = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  const correlationId = req.headers['x-correlation-id'] || requestId;
  const start = Date.now();

  // Attach IDs to request
  req.requestId = requestId;
  req.correlationId = correlationId;

  // Propagate IDs in response headers
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', correlationId);

  const logData = {
    requestId,
    correlationId,
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection.remoteAddress,
  };

  // Skip logging health/metrics endpoints to reduce noise
  const skipPaths = ['/health', '/metrics', '/health/live', '/health/ready'];
  if (!skipPaths.includes(req.path)) {
    logger.info(logData, 'Incoming request');
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    const responseLog = {
      ...logData,
      statusCode: res.statusCode,
      duration,
      contentLength: res.getHeader('content-length'),
    };

    if (!skipPaths.includes(req.path)) {
      if (res.statusCode >= 500) {
        logger.error(responseLog, 'Request completed with server error');
      } else if (res.statusCode >= 400) {
        logger.warn(responseLog, 'Request completed with client error');
      } else {
        logger.info(responseLog, 'Request completed');
      }
    }
  });

  next();
};

module.exports = { requestLogger };
