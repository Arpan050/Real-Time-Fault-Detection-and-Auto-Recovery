'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { getStatus: getCircuitBreakerStatus } = require('../config/circuitBreaker');
const logger = require('../config/logger');

let isReady = false;
let startTime = Date.now();

// Set ready after startup sequence
setTimeout(() => { isReady = true; }, 2000);

// ─── Liveness Probe ──────────────────────────────────────────────────────────
// Kubernetes checks this to decide whether to RESTART the container.
// Should only fail if the app is in an unrecoverable bad state (deadlock, OOM).
router.get('/live', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
  const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

  // Fail liveness if memory usage is critically high (>95%)
  if (heapUsagePercent > 95) {
    logger.error({ heapUsagePercent, heapUsedMB }, 'Liveness probe failed: critical memory usage');
    return res.status(503).json({
      status: 'unhealthy',
      reason: 'CRITICAL_MEMORY_USAGE',
      heapUsagePercent: heapUsagePercent.toFixed(2),
    });
  }

  res.json({
    status: 'alive',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory: {
      heapUsedMB: heapUsedMB.toFixed(2),
      heapTotalMB: heapTotalMB.toFixed(2),
      heapUsagePercent: heapUsagePercent.toFixed(2),
    },
    pid: process.pid,
  });
});

// ─── Readiness Probe ─────────────────────────────────────────────────────────
// Kubernetes checks this to decide whether to SEND TRAFFIC to the container.
// Should fail if app can't serve requests (DB not ready, dependencies down).
router.get('/ready', async (req, res) => {
  if (!isReady) {
    return res.status(503).json({ status: 'not_ready', reason: 'STARTING_UP' });
  }

  try {
    // Check DB connectivity
    await db.pool.query('SELECT 1');

    res.json({
      status: 'ready',
      checks: {
        database: 'healthy',
        application: 'healthy',
      },
    });
  } catch (err) {
    logger.error({ err }, 'Readiness probe failed: database check failed');
    res.status(503).json({
      status: 'not_ready',
      reason: 'DATABASE_UNAVAILABLE',
      error: err.message,
    });
  }
});

// ─── Full Health Check ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const checks = {};
  let overallStatus = 'healthy';

  // Database check
  try {
    const start = Date.now();
    await db.pool.query('SELECT 1');
    checks.database = { status: 'healthy', responseTimeMs: Date.now() - start };
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message };
    overallStatus = 'degraded';
  }

  // Memory check
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
  checks.memory = {
    status: heapUsedMB < 400 ? 'healthy' : 'warning',
    heapUsedMB: heapUsedMB.toFixed(2),
    rssMB: (memoryUsage.rss / 1024 / 1024).toFixed(2),
  };

  // Connection pool
  const poolStats = db.pool;
  checks.connectionPool = {
    status: 'healthy',
    total: poolStats.totalCount,
    idle: poolStats.idleCount,
    waiting: poolStats.waitingCount,
  };

  // Circuit breakers
  checks.circuitBreakers = getCircuitBreakerStatus();

  const statusCode = overallStatus === 'healthy' ? 200 : 503;

  res.status(statusCode).json({
    status: overallStatus,
    service: process.env.SERVICE_NAME || 'user-service',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  });
});

module.exports = router;
