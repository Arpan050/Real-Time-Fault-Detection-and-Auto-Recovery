'use strict';
const client = require('prom-client');
const logger = require('./logger');
const register = new client.Registry();

client.collectDefaultMetrics({ register, prefix: 'payment_service_', labels: { service: 'payment-service' } });

const httpRequestDuration = new client.Histogram({ name: 'payment_service_http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status_code'], buckets: [0.001, 0.01, 0.1, 0.5, 1, 5], registers: [register] });
const httpRequestTotal = new client.Counter({ name: 'payment_service_http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'route', 'status_code'], registers: [register] });
const httpActiveConnections = new client.Gauge({ name: 'payment_service_http_active_connections', help: 'Active connections', registers: [register] });
const httpRequestSize = new client.Histogram({ name: 'payment_service_http_request_size_bytes', help: 'Request size', labelNames: ['method', 'route'], buckets: [100, 1000, 10000], registers: [register] });
const paymentsProcessed = new client.Counter({ name: 'payment_service_payments_processed_total', help: 'Payments processed', labelNames: ['status', 'currency'], registers: [register] });
const paymentRevenue = new client.Counter({ name: 'payment_service_revenue_total', help: 'Total revenue', labelNames: ['currency'], registers: [register] });
const paymentDuration = new client.Histogram({ name: 'payment_service_processing_duration_seconds', help: 'Payment processing time', buckets: [0.1, 0.5, 1, 2, 5], registers: [register] });
const circuitBreakerState = new client.Gauge({ name: 'payment_service_circuit_breaker_state', help: 'Circuit breaker state', labelNames: ['service'], registers: [register] });
const circuitBreakerRequests = new client.Counter({ name: 'payment_service_circuit_breaker_requests_total', help: 'Circuit breaker requests', labelNames: ['service', 'outcome'], registers: [register] });
const chaosEvents = new client.Counter({ name: 'payment_service_chaos_events_total', help: 'Chaos events', labelNames: ['type'], registers: [register] });
const dbQueryDuration = new client.Histogram({ name: 'payment_service_db_query_duration_seconds', help: 'DB query duration', labelNames: ['operation', 'table'], buckets: [0.001, 0.01, 0.1, 0.5], registers: [register] });
const dbConnectionPool = new client.Gauge({ name: 'payment_service_db_pool_connections', help: 'DB pool', labelNames: ['state'], registers: [register] });
const dbQueryErrors = new client.Counter({ name: 'payment_service_db_query_errors_total', help: 'DB errors', labelNames: ['operation', 'error_type'], registers: [register] });
const userOperations = new client.Counter({ name: 'payment_service_operations_total', help: 'Operations', labelNames: ['operation', 'status'], registers: [register] });

const initMetrics = () => logger.info('Payment service metrics initialized');

module.exports = { register, httpRequestDuration, httpRequestTotal, httpActiveConnections, httpRequestSize, paymentsProcessed, paymentRevenue, paymentDuration, circuitBreakerState, circuitBreakerRequests, chaosEvents, dbQueryDuration, dbConnectionPool, dbQueryErrors, userOperations, initMetrics };
