'use strict';

require('dotenv').config();
const app = require('./app');
const logger = require('./config/logger');
const db = require('./config/database');
const { initMetrics } = require('./config/metrics');

const PORT = process.env.PORT || 3001;
const SERVICE_NAME = process.env.SERVICE_NAME || 'user-service';

// Initialize Prometheus metrics
initMetrics();

// Graceful shutdown handler
const shutdown = async (signal) => {
  logger.info({ signal, service: SERVICE_NAME }, 'Received shutdown signal, starting graceful shutdown');
  
  // Stop accepting new requests
  server.close(async () => {
    logger.info({ service: SERVICE_NAME }, 'HTTP server closed');
    
    try {
      await db.pool.end();
      logger.info({ service: SERVICE_NAME }, 'Database connections closed');
      process.exit(0);
    } catch (err) {
      logger.error({ err, service: SERVICE_NAME }, 'Error during graceful shutdown');
      process.exit(1);
    }
  });

  // Force shutdown after 30s
  setTimeout(() => {
    logger.error({ service: SERVICE_NAME }, 'Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.fatal({ err, service: SERVICE_NAME }, 'Uncaught exception — process will exit');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise, service: SERVICE_NAME }, 'Unhandled promise rejection');
});

// Connect to database, then start server
db.connect()
  .then(() => {
    logger.info({ service: SERVICE_NAME }, 'Database connected successfully');
    const server = app.listen(PORT, () => {
      logger.info({ port: PORT, service: SERVICE_NAME, env: process.env.NODE_ENV }, 'Service started');
    });
    global.server = server;
    return server;
  })
  .catch((err) => {
    logger.fatal({ err, service: SERVICE_NAME }, 'Failed to connect to database');
    process.exit(1);
  });
