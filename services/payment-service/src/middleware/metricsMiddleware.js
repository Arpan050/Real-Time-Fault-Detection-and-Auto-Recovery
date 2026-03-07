'use strict';

const {
  httpRequestDuration,
  httpRequestTotal,
  httpActiveConnections,
  httpRequestSize,
} = require('../config/metrics');

const activeConnectionsMiddleware = (req, res, next) => {
  httpActiveConnections.inc();
  res.on('finish', () => httpActiveConnections.dec());
  res.on('close', () => httpActiveConnections.dec());
  next();
};

const requestDurationMiddleware = (req, res, next) => {
  const start = Date.now();

  // Track request size
  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > 0) {
    httpRequestSize.observe({ method: req.method, route: req.path }, contentLength);
  }

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };

    httpRequestDuration.observe(labels, duration);
    httpRequestTotal.inc(labels);
  });

  next();
};

module.exports = { requestDurationMiddleware, activeConnectionsMiddleware };
