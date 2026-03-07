'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const logger = require('../config/logger');

let isReady = false;
const startTime = Date.now();
setTimeout(() => { isReady = true; }, 2000);

router.get('/live', (req, res) => {
  const mem = process.memoryUsage();
  const heapPct = (mem.heapUsed / mem.heapTotal) * 100;
  if (heapPct > 95) return res.status(503).json({ status: 'unhealthy', reason: 'CRITICAL_MEMORY_USAGE' });
  res.json({ status: 'alive', uptime: Math.floor((Date.now() - startTime) / 1000), pid: process.pid });
});

router.get('/ready', async (req, res) => {
  if (!isReady) return res.status(503).json({ status: 'not_ready', reason: 'STARTING_UP' });
  try {
    await db.pool.query('SELECT 1');
    res.json({ status: 'ready', checks: { database: 'healthy' } });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', reason: 'DATABASE_UNAVAILABLE', error: err.message });
  }
});

router.get('/', async (req, res) => {
  const checks = {};
  let status = 'healthy';
  try {
    const start = Date.now();
    await db.pool.query('SELECT 1');
    checks.database = { status: 'healthy', responseTimeMs: Date.now() - start };
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message };
    status = 'degraded';
  }
  const mem = process.memoryUsage();
  checks.memory = { heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2) };
  checks.connectionPool = { total: db.pool.totalCount, idle: db.pool.idleCount, waiting: db.pool.waitingCount };
  res.status(status === 'healthy' ? 200 : 503).json({
    status, service: 'order-service', timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000), checks,
  });
});

module.exports = router;
