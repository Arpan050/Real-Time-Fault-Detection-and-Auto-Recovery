'use strict';

const Joi = require('joi');
const db = require('../config/database');
const logger = require('../config/logger');
const { paymentsProcessed, paymentRevenue, paymentDuration, userOperations } = require('../config/metrics');
const { NotFoundError, ValidationError, AppError } = require('../middleware/errorHandler');

// Simulated payment gateway — in production this would call Stripe/Braintree/etc.
const PAYMENT_SUCCESS_RATE = parseFloat(process.env.PAYMENT_SUCCESS_RATE || '0.95');

const processWithGateway = async (payment) => {
  const processingTimeMs = Math.random() * 1000 + 200; // 200-1200ms
  await new Promise(resolve => setTimeout(resolve, processingTimeMs));

  const success = Math.random() < PAYMENT_SUCCESS_RATE;
  return {
    success,
    transactionId: success ? `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` : null,
    failureReason: success ? null : ['insufficient_funds', 'card_declined', 'network_error'][Math.floor(Math.random() * 3)],
    processingTimeMs,
  };
};

const createPaymentSchema = Joi.object({
  order_id: Joi.string().uuid().required(),
  user_id: Joi.string().uuid().required(),
  amount: Joi.number().positive().required(),
  currency: Joi.string().length(3).default('USD'),
  payment_method: Joi.string().valid('card', 'bank_transfer', 'wallet').default('card'),
  metadata: Joi.object().optional(),
});

class PaymentService {
  async getPayments({ page = 1, limit = 20, status, user_id } = {}) {
    const offset = (page - 1) * limit;
    const params = [];
    let where = 'WHERE 1=1';

    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (user_id) { params.push(user_id); where += ` AND user_id = $${params.length}`; }

    params.push(limit, offset);
    const result = await db.query(
      `SELECT * FROM payments ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { payments: result.rows };
  }

  async getPaymentById(id) {
    const result = await db.query('SELECT * FROM payments WHERE id = $1', [id]);
    if (!result.rows[0]) throw new NotFoundError('Payment');
    return result.rows[0];
  }

  async processPayment(data) {
    const { error, value } = createPaymentSchema.validate(data, { abortEarly: false });
    if (error) throw new ValidationError('Invalid payment data', error.details.map(d => d.message));

    const timer = paymentDuration.startTimer();

    // Create payment record in pending state
    let payment;
    try {
      const result = await db.query(
        `INSERT INTO payments (order_id, user_id, amount, currency, status, payment_method, metadata)
         VALUES ($1, $2, $3, $4, 'processing', $5, $6)
         RETURNING *`,
        [value.order_id, value.user_id, value.amount, value.currency, value.payment_method, JSON.stringify(value.metadata || {})]
      );
      payment = result.rows[0];
    } catch (err) {
      timer();
      userOperations.inc({ operation: 'create', status: 'error' });
      throw err;
    }

    // Process with payment gateway
    try {
      const gatewayResult = await processWithGateway(payment);
      const status = gatewayResult.success ? 'completed' : 'failed';

      const updated = await db.query(
        `UPDATE payments SET status = $1, provider_transaction_id = $2, failure_reason = $3, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [status, gatewayResult.transactionId, gatewayResult.failureReason, payment.id]
      );

      payment = updated.rows[0];

      paymentsProcessed.inc({ status, currency: value.currency });
      if (status === 'completed') paymentRevenue.inc({ currency: value.currency }, value.amount);
      userOperations.inc({ operation: 'process', status });

      logger.info({
        paymentId: payment.id, orderId: value.order_id, status,
        transactionId: gatewayResult.transactionId, amount: value.amount,
      }, 'Payment processed');

    } catch (err) {
      await db.query("UPDATE payments SET status = 'failed', failure_reason = $1 WHERE id = $2", [err.message, payment.id]);
      paymentsProcessed.inc({ status: 'failed', currency: value.currency });
      logger.error({ err, paymentId: payment.id }, 'Payment gateway error');
    } finally {
      timer();
    }

    return payment;
  }

  async refundPayment(id) {
    const payment = await this.getPaymentById(id);
    if (payment.status !== 'completed') {
      throw new AppError('Only completed payments can be refunded', 400, 'INVALID_STATE');
    }

    const refunded = await db.query(
      "UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );

    logger.info({ paymentId: id }, 'Payment refunded');
    return refunded.rows[0];
  }
}

module.exports = new PaymentService();
