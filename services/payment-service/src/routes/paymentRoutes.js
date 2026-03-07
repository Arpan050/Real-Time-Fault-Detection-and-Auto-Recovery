'use strict';
const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');

router.get('/', async (req, res, next) => {
  try { res.json(await paymentService.getPayments(req.query)); } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try { res.json({ payment: await paymentService.getPaymentById(req.params.id) }); } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try { res.status(201).json({ payment: await paymentService.processPayment(req.body) }); } catch (err) { next(err); }
});

router.post('/:id/refund', async (req, res, next) => {
  try { res.json({ payment: await paymentService.refundPayment(req.params.id) }); } catch (err) { next(err); }
});

module.exports = router;
