'use strict';

const Joi = require('joi');
const userRepository = require('./userRepository');
const logger = require('../config/logger');
const { usersCreated, usersActive, userOperations } = require('../config/metrics');
const { NotFoundError, ValidationError, ConflictError } = require('../middleware/errorHandler');

const createUserSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(100).required(),
  email: Joi.string().email().required(),
  full_name: Joi.string().min(1).max(255).optional(),
  metadata: Joi.object().optional(),
});

const updateUserSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(100).optional(),
  email: Joi.string().email().optional(),
  full_name: Joi.string().min(1).max(255).optional(),
  status: Joi.string().valid('active', 'inactive', 'suspended').optional(),
  metadata: Joi.object().optional(),
}).min(1);

class UserService {
  async getUsers({ page = 1, limit = 20, status, search } = {}) {
    const offset = (page - 1) * limit;
    const [users, total] = await Promise.all([
      userRepository.findAll({ limit, offset, status, search }),
      userRepository.count({ status, search }),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async getUserById(id) {
    const user = await userRepository.findById(id);
    if (!user) throw new NotFoundError('User');

    userOperations.inc({ operation: 'read', status: 'success' });
    return user;
  }

  async createUser(data) {
    const { error, value } = createUserSchema.validate(data, { abortEarly: false });
    if (error) {
      throw new ValidationError('Invalid user data', error.details.map(d => d.message));
    }

    // Check uniqueness
    const existing = await userRepository.findByEmail(value.email);
    if (existing) throw new ConflictError('User with this email already exists');

    try {
      const user = await userRepository.create(value);
      usersCreated.inc();
      userOperations.inc({ operation: 'create', status: 'success' });

      // Update active users gauge
      const activeCount = await userRepository.countActiveUsers();
      usersActive.set(activeCount);

      logger.info({ userId: user.id, email: user.email }, 'User created successfully');
      return user;
    } catch (err) {
      userOperations.inc({ operation: 'create', status: 'error' });
      if (err.code === '23505') { // Postgres unique violation
        throw new ConflictError('Username or email already exists');
      }
      throw err;
    }
  }

  async updateUser(id, data) {
    const { error, value } = updateUserSchema.validate(data, { abortEarly: false });
    if (error) {
      throw new ValidationError('Invalid update data', error.details.map(d => d.message));
    }

    if (value.email) {
      const existing = await userRepository.findByEmail(value.email);
      if (existing && existing.id !== id) {
        throw new ConflictError('Email already in use by another user');
      }
    }

    try {
      const user = await userRepository.update(id, value);
      if (!user) throw new NotFoundError('User');

      userOperations.inc({ operation: 'update', status: 'success' });
      logger.info({ userId: id }, 'User updated successfully');
      return user;
    } catch (err) {
      userOperations.inc({ operation: 'update', status: 'error' });
      throw err;
    }
  }

  async deleteUser(id) {
    const deleted = await userRepository.delete(id);
    if (!deleted) throw new NotFoundError('User');

    userOperations.inc({ operation: 'delete', status: 'success' });

    const activeCount = await userRepository.countActiveUsers();
    usersActive.set(activeCount);

    logger.info({ userId: id }, 'User deleted successfully');
    return { deleted: true, id };
  }
}

module.exports = new UserService();
