'use strict';
require('dotenv').config();
const app = require('./app');
const logger = require('./config/logger');
const db = require('./config/database');
const { initMetrics } = require('./config/metrics');
const PORT = process.env.PORT || 3002;

initMetrics();
process.on('SIGTERM', async () => { await db.pool.end(); process.exit(0); });
process.on('SIGINT', async () => { await db.pool.end(); process.exit(0); });
process.on('uncaughtException', (err) => { logger.error({ err }, 'Uncaught exception'); process.exit(1); });

db.connect()
  .then(() => app.listen(PORT, () => logger.info({ port: PORT, service: 'order-service' }, 'Service started')))
  .catch((err) => { logger.error({ err }, 'Startup failed'); process.exit(1); });
