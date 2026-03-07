'use strict';

const axios = require('axios');
const Joi = require('joi');
const db = require('../config/database');
const logger = require('../config/logger');
const { createBreaker } = require('../config/circuitBreaker');
const { ordersCreated, orderRevenue, userOperations } = require('../config/metrics');
const { NotFoundError, ValidationError, AppError } = require('../middleware/errorHandler');

// ─── Circuit Breaker: Payment Service ───────────────────────────────────────
const callPaymentService = async (payload) => {
  const url = `${process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3003'}/api/payments`;
  const response = await axios.post(url, payload, { timeout: 5000 });
  return response.data;
};

const paymentBreaker = createBreaker('payment-service', callPaymentService, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

// ─── Circuit Breaker: Notification Service ───────────────────────────────────
const callNotificationService = async (payload) => {
  const url = `${process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3004'}/api/notifications`;
  const response = await axios.post(url, payload, { timeout: 3000 });
  return response.data;
};

const notificationBreaker = createBreaker('notification-service', callNotificationService, {
  timeout: 3000,
  errorThresholdPercentage: 60,  // More tolerant — notifications are non-critical
  resetTimeout: 20000,
});

const createOrderSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  items: Joi.array().items(
    Joi.object({
      product_id: Joi.string().required(),
      name: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
      unit_price: Joi.number().min(0).required(),
    })
  ).min(1).required(),
  shipping_address: Joi.object({
    street: Joi.string().required(),
    city: Joi.string().required(),
    country: Joi.string().required(),
    postal_code: Joi.string().required(),
  }).required(),
  currency: Joi.string().length(3).default('USD'),
  metadata: Joi.object().optional(),
});

class OrderService {
  async getOrders({ page = 1, limit = 20, status, user_id } = {}) {
    const offset = (page - 1) * limit;
    const params = [];
    let where = 'WHERE 1=1';

    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (user_id) { params.push(user_id); where += ` AND user_id = $${params.length}`; }

    params.push(limit, offset);

    const [orders, countResult] = await Promise.all([
      db.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      db.query(`SELECT COUNT(*) FROM orders ${where}`, params.slice(0, -2)),
    ]);

    return {
      orders: orders.rows,
      pagination: { page, limit, total: parseInt(countResult.rows[0].count) },
    };
  }

  async getOrderById(id) {
    const result = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (!result.rows[0]) throw new NotFoundError('Order');
    return result.rows[0];
  }

  async createOrder(data) {
    const { error, value } = createOrderSchema.validate(data, { abortEarly: false });
    if (error) throw new ValidationError('Invalid order data', error.details.map(d => d.message));

    const totalAmount = value.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);

    // ─── Step 1: Create order in DB ──────────────────────────────────────────
    let order;
    try {
      const result = await db.query(
        `INSERT INTO orders (user_id, status, total_amount, currency, items, shipping_address, metadata)
         VALUES ($1, 'pending', $2, $3, $4, $5, $6)
         RETURNING *`,
        [value.user_id, totalAmount, value.currency, JSON.stringify(value.items),
         JSON.stringify(value.shipping_address), JSON.stringify(value.metadata || {})]
      );
      order = result.rows[0];
    } catch (err) {
      userOperations.inc({ operation: 'create', status: 'error' });
      throw err;
    }

    // ─── Step 2: Call Payment Service (circuit breaker protected) ────────────
    let paymentResult;
    try {
      paymentResult = await paymentBreaker.fire({
        order_id: order.id,
        user_id: value.user_id,
        amount: totalAmount,
        currency: value.currency,
        metadata: { order_id: order.id },
      });

      if (paymentResult.error) {
        // Circuit breaker fallback triggered
        logger.warn({ orderId: order.id, paymentResult }, 'Payment service unavailable, order held in pending');
        await this._updateOrderStatus(order.id, 'pending', { payment_failure: paymentResult.error });
      } else {
        await this._updateOrderStatus(order.id, 'confirmed', { payment_id: paymentResult.payment?.id });
        order.status = 'confirmed';
        order.payment_id = paymentResult.payment?.id;
      }
    } catch (err) {
      logger.error({ err, orderId: order.id }, 'Payment service call failed');
      // Order stays in pending — can be retried
    }

    // ─── Step 3: Send notification (non-blocking, circuit breaker protected) ─
    notificationBreaker.fire({
      user_id: value.user_id,
      type: 'ORDER_CREATED',
      channel: 'email',
      payload: { order_id: order.id, total_amount: totalAmount, status: order.status },
    }).catch((err) => {
      logger.warn({ err, orderId: order.id }, 'Notification service call failed (non-critical)');
    });

    ordersCreated.inc();
    orderRevenue.inc({ currency: value.currency }, totalAmount);
    userOperations.inc({ operation: 'create', status: 'success' });

    return order;
  }

  async updateOrderStatus(id, status, metadata = {}) {
    const order = await this.getOrderById(id);
    const updated = await this._updateOrderStatus(id, status, metadata);

    // Fire notification asynchronously
    notificationBreaker.fire({
      user_id: order.user_id,
      type: 'ORDER_STATUS_UPDATED',
      channel: 'email',
      payload: { order_id: id, old_status: order.status, new_status: status },
    }).catch(() => {});

    return updated;
  }

  async _updateOrderStatus(id, status, metadata = {}) {
    const result = await db.query(
      `UPDATE orders SET status = $1, metadata = metadata || $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, JSON.stringify(metadata), id]
    );

    await db.query(
      `INSERT INTO order_events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
      [id, `STATUS_CHANGED_TO_${status.toUpperCase()}`, JSON.stringify({ status, ...metadata })]
    );

    return result.rows[0];
  }

  async deleteOrder(id) {
    const order = await this.getOrderById(id);
    if (!['pending', 'cancelled'].includes(order.status)) {
      throw new AppError('Only pending or cancelled orders can be deleted', 400, 'INVALID_STATE');
    }
    await db.query('DELETE FROM orders WHERE id = $1', [id]);
    return { deleted: true, id };
  }
}

module.exports = new OrderService();
