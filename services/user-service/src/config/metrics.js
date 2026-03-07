'use strict';

const client = require('prom-client');
const logger = require('./logger');

// Create a custom registry
const register = new client.Registry();

// Add default Node.js metrics
client.collectDefaultMetrics({
  register,
  prefix: 'user_service_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  labels: { service: 'user-service' },
});

// ─── HTTP Metrics ────────────────────────────────────────────────────────────

const httpRequestDuration = new client.Histogram({
  name: 'user_service_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'user_service_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpActiveConnections = new client.Gauge({
  name: 'user_service_http_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

const httpRequestSize = new client.Histogram({
  name: 'user_service_http_request_size_bytes',
  help: 'Size of HTTP requests in bytes',
  labelNames: ['method', 'route'],
  buckets: [100, 1000, 5000, 10000, 50000, 100000],
  registers: [register],
});

// ─── Database Metrics ────────────────────────────────────────────────────────

const dbQueryDuration = new client.Histogram({
  name: 'user_service_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [register],
});

const dbConnectionPool = new client.Gauge({
  name: 'user_service_db_pool_connections',
  help: 'Database connection pool status',
  labelNames: ['state'],
  registers: [register],
});

const dbQueryErrors = new client.Counter({
  name: 'user_service_db_query_errors_total',
  help: 'Total number of database query errors',
  labelNames: ['operation', 'error_type'],
  registers: [register],
});

// ─── Business Metrics ────────────────────────────────────────────────────────

const usersCreated = new client.Counter({
  name: 'user_service_users_created_total',
  help: 'Total number of users created',
  registers: [register],
});

const usersActive = new client.Gauge({
  name: 'user_service_users_active',
  help: 'Number of active users',
  registers: [register],
});

const userOperations = new client.Counter({
  name: 'user_service_user_operations_total',
  help: 'Total user CRUD operations',
  labelNames: ['operation', 'status'],
  registers: [register],
});

// ─── Circuit Breaker Metrics ─────────────────────────────────────────────────

const circuitBreakerState = new client.Gauge({
  name: 'user_service_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
  registers: [register],
});

const circuitBreakerRequests = new client.Counter({
  name: 'user_service_circuit_breaker_requests_total',
  help: 'Total requests through circuit breaker',
  labelNames: ['service', 'outcome'],
  registers: [register],
});

// ─── Chaos / Failure Simulation Metrics ──────────────────────────────────────

const chaosEvents = new client.Counter({
  name: 'user_service_chaos_events_total',
  help: 'Total chaos/fault injection events triggered',
  labelNames: ['type'],
  registers: [register],
});

const initMetrics = () => {
  logger.info({ service: 'user-service' }, 'Prometheus metrics initialized');
};

module.exports = {
  register,
  httpRequestDuration,
  httpRequestTotal,
  httpActiveConnections,
  httpRequestSize,
  dbQueryDuration,
  dbConnectionPool,
  dbQueryErrors,
  usersCreated,
  usersActive,
  userOperations,
  circuitBreakerState,
  circuitBreakerRequests,
  chaosEvents,
  initMetrics,
};
