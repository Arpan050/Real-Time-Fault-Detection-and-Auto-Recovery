'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { Pool } = require('pg');
const client = require('prom-client');
const winston = require('winston');
const rateLimit = require('express-rate-limit');

// ─── Logger ──────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'notification-service' },
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// ─── Metrics ──────────────────────────────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'notification_service_', labels: { service: 'notification-service' } });

const httpRequestDuration = new client.Histogram({ name: 'notification_service_http_request_duration_seconds', help: 'HTTP duration', labelNames: ['method', 'route', 'status_code'], buckets: [0.001, 0.01, 0.1, 0.5, 1], registers: [register] });
const httpRequestTotal = new client.Counter({ name: 'notification_service_http_requests_total', help: 'Total requests', labelNames: ['method', 'route', 'status_code'], registers: [register] });
const httpActiveConnections = new client.Gauge({ name: 'notification_service_http_active_connections', help: 'Active connections', registers: [register] });
const httpRequestSize = new client.Histogram({ name: 'notification_service_http_request_size_bytes', help: 'Request size', labelNames: ['method', 'route'], buckets: [100, 1000], registers: [register] });
const notificationsSent = new client.Counter({ name: 'notification_service_sent_total', help: 'Notifications sent', labelNames: ['type', 'channel', 'status'], registers: [register] });
const chaosEvents = new client.Counter({ name: 'notification_service_chaos_events_total', help: 'Chaos events', labelNames: ['type'], registers: [register] });
const dbQueryDuration = new client.Histogram({ name: 'notification_service_db_query_duration_seconds', help: 'DB query duration', labelNames: ['operation'], buckets: [0.001, 0.01, 0.1], registers: [register] });
const dbConnectionPool = new client.Gauge({ name: 'notification_service_db_pool_connections', help: 'Pool size', labelNames: ['state'], registers: [register] });
const dbQueryErrors = new client.Counter({ name: 'notification_service_db_query_errors_total', help: 'DB errors', labelNames: ['operation', 'error_type'], registers: [register] });
const userOperations = new client.Counter({ name: 'notification_service_operations_total', help: 'Operations', labelNames: ['operation', 'status'], registers: [register] });
const circuitBreakerState = new client.Gauge({ name: 'notification_service_circuit_breaker_state', help: 'CB state', labelNames: ['service'], registers: [register] });
const circuitBreakerRequests = new client.Counter({ name: 'notification_service_circuit_breaker_requests_total', help: 'CB requests', labelNames: ['service', 'outcome'], registers: [register] });

// ─── Database ─────────────────────────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'notifications_db', user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres', max: 20, connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => logger.error({ err }, 'DB pool error'));

const dbQuery = async (text, params) => {
  try { return await pool.query(text, params); }
  catch (err) { logger.error({ err, query: text }, 'Query failed'); throw err; }
};

const initDb = async () => {
  const c = await pool.connect();
  try {
    await c.query('SELECT 1');
    await c.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        type VARCHAR(50) NOT NULL,
        channel VARCHAR(20) DEFAULT 'email' CHECK (channel IN ('email','sms','push','webhook')),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','bounced')),
        subject VARCHAR(500),
        body TEXT,
        payload JSONB DEFAULT '{}',
        attempts INT DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notif_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);
      CREATE INDEX IF NOT EXISTS idx_notif_type ON notifications(type);
    `);
    logger.info('Notification service migrations completed');
  } finally { c.release(); }
};

// ─── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(helmet()); app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(express.json({ limit: '10mb' }));

// Metrics middleware
app.use((req, res, next) => {
  httpActiveConnections.inc();
  res.on('finish', () => httpActiveConnections.dec());
  const start = Date.now();
  res.on('finish', () => {
    const dur = (Date.now() - start) / 1000;
    const labels = { method: req.method, route: req.route?.path || req.path, status_code: res.statusCode };
    httpRequestDuration.observe(labels, dur);
    httpRequestTotal.inc(labels);
  });
  next();
});

// Request logger
app.use((req, res, next) => {
  const skip = ['/health', '/metrics'].includes(req.path);
  if (!skip) logger.info({ method: req.method, path: req.path }, 'Request');
  res.on('finish', () => { if (!skip) logger.info({ method: req.method, path: req.path, status: res.statusCode }, 'Response'); });
  next();
});

// ─── Health ───────────────────────────────────────────────────────────────────
const startTime = Date.now();
let isReady = false;
setTimeout(() => { isReady = true; }, 2000);

app.get('/health/live', (req, res) => {
  const mem = process.memoryUsage();
  if ((mem.heapUsed / mem.heapTotal) * 100 > 95) return res.status(503).json({ status: 'unhealthy' });
  res.json({ status: 'alive', uptime: Math.floor((Date.now() - startTime) / 1000) });
});

app.get('/health/ready', async (req, res) => {
  if (!isReady) return res.status(503).json({ status: 'not_ready', reason: 'STARTING_UP' });
  try { await pool.query('SELECT 1'); res.json({ status: 'ready' }); }
  catch { res.status(503).json({ status: 'not_ready', reason: 'DATABASE_UNAVAILABLE' }); }
});

app.get('/health', async (req, res) => {
  try {
    const s = Date.now(); await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'notification-service', uptime: Math.floor((Date.now() - startTime) / 1000), checks: { database: { status: 'healthy', responseTimeMs: Date.now() - s } } });
  } catch (err) {
    res.status(503).json({ status: 'degraded', checks: { database: { status: 'unhealthy', error: err.message } } });
  }
});

// ─── Metrics endpoint ─────────────────────────────────────────────────────────
app.get('/metrics', async (req, res) => {
  const metrics = await register.metrics();
  res.set('Content-Type', register.contentType);
  res.end(metrics);
});

// ─── Notification Routes ──────────────────────────────────────────────────────
app.get('/api/notifications', async (req, res) => {
  try {
    const { user_id, type, channel, status, limit = 20, page = 1 } = req.query;
    const params = []; let where = 'WHERE 1=1';
    if (user_id) { params.push(user_id); where += ` AND user_id = $${params.length}`; }
    if (type) { params.push(type); where += ` AND type = $${params.length}`; }
    if (channel) { params.push(channel); where += ` AND channel = $${params.length}`; }
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    const result = await dbQuery(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ notifications: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/notifications', async (req, res) => {
  try {
    const { user_id, type, channel = 'email', payload = {} } = req.body;
    if (!user_id || !type) return res.status(422).json({ error: 'user_id and type are required' });

    // Build notification content based on type
    const templates = {
      ORDER_CREATED: { subject: 'Your order has been placed!', body: `Order ${payload.order_id} for $${payload.total_amount} is ${payload.status}.` },
      ORDER_STATUS_UPDATED: { subject: 'Order status updated', body: `Your order ${payload.order_id} status changed to ${payload.new_status}.` },
      PAYMENT_COMPLETED: { subject: 'Payment received', body: `Payment of $${payload.amount} confirmed.` },
      DEFAULT: { subject: `Notification: ${type}`, body: JSON.stringify(payload) },
    };
    const template = templates[type] || templates.DEFAULT;

    const result = await dbQuery(
      `INSERT INTO notifications (user_id, type, channel, status, subject, body, payload)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6) RETURNING *`,
      [user_id, type, channel, template.subject, template.body, JSON.stringify(payload)]
    );

    const notification = result.rows[0];

    // Simulate async send (in production this would queue to SQS/Rabbit)
    setTimeout(async () => {
      try {
        // Simulate delivery (95% success)
        const success = Math.random() < 0.95;
        const status = success ? 'sent' : 'failed';
        await dbQuery(
          `UPDATE notifications SET status = $1, attempts = attempts + 1, last_attempt_at = NOW(), sent_at = $2 WHERE id = $3`,
          [status, success ? new Date() : null, notification.id]
        );
        notificationsSent.inc({ type, channel, status });
        logger.info({ notificationId: notification.id, type, channel, status }, 'Notification delivery attempt');
      } catch (err) {
        logger.error({ err, notificationId: notification.id }, 'Delivery failed');
      }
    }, Math.random() * 500);

    userOperations.inc({ operation: 'send', status: 'queued' });
    res.status(201).json({ notification });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications/:id', async (req, res) => {
  try {
    const result = await dbQuery('SELECT * FROM notifications WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Chaos Routes ──────────────────────────────────────────────────────────────
let chaosState = { delayEnabled: false, delayMs: 0, errorRate: 0 };

app.post('/chaos/delay', (req, res) => {
  const { enabled, delayMs = 1000 } = req.body;
  chaosState.delayEnabled = enabled; chaosState.delayMs = delayMs;
  chaosEvents.inc({ type: 'delay' });
  res.json({ message: 'Delay configured', chaosState });
});

app.post('/chaos/error-rate', (req, res) => {
  chaosState.errorRate = Math.min(Math.max(req.body.rate || 0, 0), 1);
  chaosEvents.inc({ type: 'error_rate' });
  res.json({ message: 'Error rate configured', chaosState });
});

app.post('/chaos/crash', (req, res) => {
  const delay = req.body.delay || 1000;
  chaosEvents.inc({ type: 'crash' });
  res.json({ message: `Crashing in ${delay}ms` });
  setTimeout(() => process.exit(1), delay);
});

app.get('/chaos/state', (req, res) => res.json({ chaosState }));
app.post('/chaos/reset', (req, res) => {
  chaosState = { delayEnabled: false, delayMs: 0, errorRate: 0 };
  res.json({ message: 'Reset', chaosState });
});

// ─── Error Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3004;
process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
process.on('SIGINT', async () => { await pool.end(); process.exit(0); });
process.on('uncaughtException', (err) => { logger.error({ err }, 'Uncaught exception'); process.exit(1); });

initDb()
  .then(() => app.listen(PORT, () => logger.info({ port: PORT, service: 'notification-service' }, 'Service started')))
  .catch((err) => { logger.error({ err }, 'Startup failed'); process.exit(1); });
