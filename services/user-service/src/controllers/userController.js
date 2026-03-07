'use strict';

const userService = require('../services/userService');
const logger = require('../config/logger');

class UserController {
  async getUsers(req, res, next) {
    try {
      const { page, limit, status, search } = req.query;
      const result = await userService.getUsers({
        page: parseInt(page) || 1,
        limit: Math.min(parseInt(limit) || 20, 100),
        status,
        search,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async getUserById(req, res, next) {
    try {
      const user = await userService.getUserById(req.params.id);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }

  async createUser(req, res, next) {
    try {
      const user = await userService.createUser(req.body);
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  }

  async updateUser(req, res, next) {
    try {
      const user = await userService.updateUser(req.params.id, req.body);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }

  async deleteUser(req, res, next) {
    try {
      const result = await userService.deleteUser(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new UserController();
