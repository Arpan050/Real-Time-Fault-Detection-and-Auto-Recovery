'use strict';

const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, status, user_id } = req.query;
    const result = await orderService.getOrders({
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
      status, user_id,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    res.json({ order });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json({ order });
  } catch (err) { next(err); }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, metadata } = req.body;
    const order = await orderService.updateOrderStatus(req.params.id, status, metadata);
    res.json({ order });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await orderService.deleteOrder(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
