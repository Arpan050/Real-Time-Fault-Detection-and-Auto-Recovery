'use strict';
const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'payments_db', user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres', max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => logger.error({ err }, 'DB pool error'));

const connect = async () => {
  const client = await pool.connect();
  try { await client.query('SELECT 1'); await runMigrations(client); }
  finally { client.release(); }
};

const runMigrations = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL,
      user_id UUID NOT NULL,
      amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
      currency VARCHAR(3) DEFAULT 'USD',
      status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending','processing','completed','failed','refunded','cancelled')),
      payment_method VARCHAR(50) DEFAULT 'card',
      provider_transaction_id VARCHAR(255),
      failure_reason TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  `);
  logger.info('Payment service migrations completed');
};

const query = async (text, params) => {
  try { return await pool.query(text, params); }
  catch (err) { logger.error({ err, query: text }, 'Query failed'); throw err; }
};

const transaction = async (callback) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
};

module.exports = { pool, connect, query, transaction };
