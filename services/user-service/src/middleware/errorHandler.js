'use strict';

const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational || false;

  const errorResponse = {
    error: {
      message: isOperational ? err.message : 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
      requestId: req.requestId,
      correlationId: req.correlationId,
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    errorResponse.error.stack = err.stack;
    errorResponse.error.details = err.details;
  }

  logger.error({
    err,
    requestId: req.requestId,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    statusCode,
    isOperational,
  }, 'Request error');

  res.status(statusCode).json(errorResponse);
};

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

module.exports = { errorHandler, AppError, NotFoundError, ValidationError, ConflictError };
