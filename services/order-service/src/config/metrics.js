'use strict';

const client = require('prom-client');
const logger = require('./logger');

const register = new client.Registry();

client.collectDefaultMetrics({ register, prefix: 'order_service_', labels: { service: 'order-service' } });

const httpRequestDuration = new client.Histogram({
  name: 'order_service_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'order_service_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpActiveConnections = new client.Gauge({
  name: 'order_service_http_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

const httpRequestSize = new client.Histogram({
  name: 'order_service_http_request_size_bytes',
  help: 'Request size in bytes',
  labelNames: ['method', 'route'],
  buckets: [100, 1000, 5000, 10000],
  registers: [register],
});

const ordersCreated = new client.Counter({
  name: 'order_service_orders_created_total',
  help: 'Total orders created',
  registers: [register],
});

const ordersByStatus = new client.Gauge({
  name: 'order_service_orders_by_status',
  help: 'Orders grouped by status',
  labelNames: ['status'],
  registers: [register],
});

const orderRevenue = new client.Counter({
  name: 'order_service_revenue_total',
  help: 'Total revenue processed',
  labelNames: ['currency'],
  registers: [register],
});

const circuitBreakerState = new client.Gauge({
  name: 'order_service_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
  registers: [register],
});

const circuitBreakerRequests = new client.Counter({
  name: 'order_service_circuit_breaker_requests_total',
  help: 'Circuit breaker requests',
  labelNames: ['service', 'outcome'],
  registers: [register],
});

const chaosEvents = new client.Counter({
  name: 'order_service_chaos_events_total',
  help: 'Chaos events triggered',
  labelNames: ['type'],
  registers: [register],
});

const dbQueryDuration = new client.Histogram({
  name: 'order_service_db_query_duration_seconds',
  help: 'DB query duration',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1],
  registers: [register],
});

const dbConnectionPool = new client.Gauge({
  name: 'order_service_db_pool_connections',
  help: 'DB pool connections',
  labelNames: ['state'],
  registers: [register],
});

const dbQueryErrors = new client.Counter({
  name: 'order_service_db_query_errors_total',
  help: 'DB query errors',
  labelNames: ['operation', 'error_type'],
  registers: [register],
});

const userOperations = new client.Counter({
  name: 'order_service_operations_total',
  help: 'Order operations',
  labelNames: ['operation', 'status'],
  registers: [register],
});

const initMetrics = () => logger.info({ service: 'order-service' }, 'Metrics initialized');

module.exports = {
  register, httpRequestDuration, httpRequestTotal, httpActiveConnections, httpRequestSize,
  ordersCreated, ordersByStatus, orderRevenue, circuitBreakerState, circuitBreakerRequests,
  chaosEvents, dbQueryDuration, dbConnectionPool, dbQueryErrors, userOperations, initMetrics,
};
