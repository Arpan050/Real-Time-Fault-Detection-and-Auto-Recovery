'use strict';

const CircuitBreaker = require('opossum');
const logger = require('./logger');
const { circuitBreakerState, circuitBreakerRequests } = require('./metrics');

const DEFAULT_OPTIONS = {
  timeout: 5000,           // Timeout after 5 seconds
  errorThresholdPercentage: 50,  // Open circuit if 50% requests fail
  resetTimeout: 30000,      // Try again after 30 seconds (half-open)
  volumeThreshold: 5,       // Minimum 5 requests before tracking
  rollingCountTimeout: 10000,
  rollingCountBuckets: 10,
};

const breakers = new Map();

const createBreaker = (name, asyncFn, options = {}) => {
  const breakerOptions = { ...DEFAULT_OPTIONS, ...options, name };
  const breaker = new CircuitBreaker(asyncFn, breakerOptions);

  // Event handlers
  breaker.on('open', () => {
    logger.warn({ circuitBreaker: name, state: 'OPEN' }, 'Circuit breaker opened — requests will fail fast');
    circuitBreakerState.set({ service: name }, 1);
  });

  breaker.on('halfOpen', () => {
    logger.info({ circuitBreaker: name, state: 'HALF_OPEN' }, 'Circuit breaker half-open — testing recovery');
    circuitBreakerState.set({ service: name }, 2);
  });

  breaker.on('close', () => {
    logger.info({ circuitBreaker: name, state: 'CLOSED' }, 'Circuit breaker closed — service recovered');
    circuitBreakerState.set({ service: name }, 0);
  });

  breaker.on('success', () => {
    circuitBreakerRequests.inc({ service: name, outcome: 'success' });
  });

  breaker.on('failure', (err) => {
    logger.warn({ circuitBreaker: name, error: err.message }, 'Circuit breaker recorded failure');
    circuitBreakerRequests.inc({ service: name, outcome: 'failure' });
  });

  breaker.on('timeout', () => {
    logger.warn({ circuitBreaker: name }, 'Circuit breaker request timed out');
    circuitBreakerRequests.inc({ service: name, outcome: 'timeout' });
  });

  breaker.on('reject', () => {
    logger.warn({ circuitBreaker: name }, 'Circuit breaker rejected request (open)');
    circuitBreakerRequests.inc({ service: name, outcome: 'rejected' });
  });

  breaker.fallback(() => {
    return { error: 'Service temporarily unavailable', circuitBreaker: name, state: 'OPEN' };
  });

  // Initialize metric
  circuitBreakerState.set({ service: name }, 0);
  
  breakers.set(name, breaker);
  logger.info({ circuitBreaker: name }, 'Circuit breaker created');
  
  return breaker;
};

const getBreaker = (name) => breakers.get(name);

const getStatus = () => {
  const status = {};
  for (const [name, breaker] of breakers) {
    status[name] = {
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      stats: breaker.stats,
    };
  }
  return status;
};

module.exports = { createBreaker, getBreaker, getStatus };
