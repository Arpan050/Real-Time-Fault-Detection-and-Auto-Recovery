'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { chaosEvents } = require('../config/metrics');

// ─── Chaos Endpoints for Failure Simulation ───────────────────────────────────
// These endpoints simulate various failure modes for resilience testing.
// In production, protect these behind authentication and feature flags.

// Track chaos state
const chaosState = {
  delayEnabled: false,
  delayMs: 0,
  errorRate: 0,
  memoryLeakActive: false,
};

let memoryLeakArray = [];

// ─── Artificial Delay ────────────────────────────────────────────────────────
// POST /chaos/delay { "enabled": true, "delayMs": 3000 }
router.post('/delay', (req, res) => {
  const { enabled, delayMs = 1000 } = req.body;
  chaosState.delayEnabled = enabled;
  chaosState.delayMs = delayMs;

  chaosEvents.inc({ type: 'delay' });
  logger.warn({ chaosState }, '[CHAOS] Artificial delay configured');
  res.json({ message: 'Delay configured', chaosState });
});

// ─── Random Error Rate ────────────────────────────────────────────────────────
// POST /chaos/error-rate { "rate": 0.5 } (50% of requests will fail)
router.post('/error-rate', (req, res) => {
  const { rate = 0 } = req.body;
  chaosState.errorRate = Math.min(Math.max(rate, 0), 1);

  chaosEvents.inc({ type: 'error_rate' });
  logger.warn({ chaosState }, '[CHAOS] Error rate configured');
  res.json({ message: 'Error rate configured', chaosState });
});

// ─── Memory Leak Simulation ───────────────────────────────────────────────────
// POST /chaos/memory-leak { "enabled": true }
router.post('/memory-leak', (req, res) => {
  const { enabled } = req.body;
  chaosState.memoryLeakActive = enabled;

  if (enabled) {
    chaosEvents.inc({ type: 'memory_leak' });
    logger.warn('[CHAOS] Memory leak simulation STARTED');
    
    const interval = setInterval(() => {
      if (!chaosState.memoryLeakActive) {
        clearInterval(interval);
        memoryLeakArray = [];
        logger.info('[CHAOS] Memory leak simulation STOPPED, memory released');
        return;
      }
      // Allocate ~1MB every 100ms
      memoryLeakArray.push(Buffer.alloc(1024 * 1024, 'x'));
      logger.debug({ allocatedMB: memoryLeakArray.length }, '[CHAOS] Memory leak tick');
    }, 100);
  } else {
    memoryLeakArray = [];
    logger.info('[CHAOS] Memory leak simulation stopped');
  }

  res.json({ message: `Memory leak ${enabled ? 'started' : 'stopped'}`, chaosState });
});

// ─── Process Crash ────────────────────────────────────────────────────────────
// POST /chaos/crash { "delay": 2000 } — simulates unrecoverable crash
router.post('/crash', (req, res) => {
  const { delay = 1000 } = req.body;

  chaosEvents.inc({ type: 'crash' });
  logger.fatal({ delay }, '[CHAOS] PROCESS CRASH SCHEDULED — Kubernetes should auto-restart');
  
  res.json({ message: `Process will crash in ${delay}ms — watch Kubernetes restart it`, delay });

  setTimeout(() => {
    process.exit(1);
  }, delay);
});

// ─── CPU Spike ────────────────────────────────────────────────────────────────
// POST /chaos/cpu-spike { "durationMs": 5000 }
router.post('/cpu-spike', (req, res) => {
  const { durationMs = 5000 } = req.body;

  chaosEvents.inc({ type: 'cpu_spike' });
  logger.warn({ durationMs }, '[CHAOS] CPU spike simulation started');

  res.json({ message: `CPU spike running for ${durationMs}ms`, durationMs });

  // Burn CPU synchronously (blocks event loop — intentional for chaos)
  const end = Date.now() + durationMs;
  let i = 0;
  while (Date.now() < end) {
    Math.sqrt(i++);
  }
  logger.info('[CHAOS] CPU spike completed');
});

// ─── Database Connection Pool Exhaustion ──────────────────────────────────────
// POST /chaos/db-pool-exhaust { "connections": 25, "holdMs": 10000 }
router.post('/db-pool-exhaust', async (req, res) => {
  const { connections = 15, holdMs = 5000 } = req.body;
  const db = require('../config/database');

  chaosEvents.inc({ type: 'db_pool_exhaust' });
  logger.warn({ connections, holdMs }, '[CHAOS] DB connection pool exhaustion started');

  const clients = [];
  try {
    for (let i = 0; i < connections; i++) {
      const client = await db.pool.connect();
      clients.push(client);
    }

    res.json({ message: `Holding ${clients.length} DB connections for ${holdMs}ms`, connections: clients.length });

    await new Promise(resolve => setTimeout(resolve, holdMs));
  } finally {
    clients.forEach(c => c.release());
    logger.info('[CHAOS] DB connections released');
  }
});

// ─── Get Current Chaos State ──────────────────────────────────────────────────
router.get('/state', (req, res) => {
  res.json({
    chaosState,
    memoryLeakAllocatedMB: memoryLeakArray.length,
  });
});

// ─── Reset All Chaos ──────────────────────────────────────────────────────────
router.post('/reset', (req, res) => {
  chaosState.delayEnabled = false;
  chaosState.delayMs = 0;
  chaosState.errorRate = 0;
  chaosState.memoryLeakActive = false;
  memoryLeakArray = [];

  logger.info('[CHAOS] All chaos state reset');
  res.json({ message: 'Chaos state reset', chaosState });
});

// ─── Chaos Middleware (apply to all app routes) ───────────────────────────────
const chaosMiddleware = async (req, res, next) => {
  // Skip chaos for /chaos, /health, /metrics endpoints
  if (req.path.startsWith('/chaos') || req.path.startsWith('/health') || req.path.startsWith('/metrics')) {
    return next();
  }

  if (chaosState.errorRate > 0 && Math.random() < chaosState.errorRate) {
    logger.warn({ path: req.path }, '[CHAOS] Injecting artificial error');
    return res.status(503).json({ error: 'Chaos-injected error', type: 'RANDOM_FAILURE' });
  }

  if (chaosState.delayEnabled && chaosState.delayMs > 0) {
    logger.debug({ delayMs: chaosState.delayMs, path: req.path }, '[CHAOS] Injecting delay');
    await new Promise(resolve => setTimeout(resolve, chaosState.delayMs));
  }

  next();
};

module.exports = router;
module.exports.chaosMiddleware = chaosMiddleware;
