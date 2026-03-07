'use strict';

const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'users_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', (client) => {
  logger.debug({ service: 'user-service' }, 'New database client connected');
});

pool.on('error', (err, client) => {
  logger.error({ err }, 'Unexpected database pool error');
});

pool.on('remove', () => {
  logger.debug({ service: 'user-service' }, 'Database client removed from pool');
});

const connect = async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    logger.info({ service: 'user-service', host: process.env.DB_HOST }, 'Database ping successful');
    
    // Run migrations
    await runMigrations(client);
  } finally {
    client.release();
  }
};

const runMigrations = async (client) => {
  logger.info({ service: 'user-service' }, 'Running database migrations');
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      full_name VARCHAR(255),
      status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_audit_log (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(50) NOT NULL,
      old_values JSONB,
      new_values JSONB,
      performed_by VARCHAR(255),
      performed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  await client.query(`
    DROP TRIGGER IF EXISTS update_users_updated_at ON users;
    CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `);

  logger.info({ service: 'user-service' }, 'Migrations completed successfully');
};

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ query: text, duration, rows: result.rowCount }, 'Database query executed');
    return result;
  } catch (err) {
    logger.error({ err, query: text }, 'Database query failed');
    throw err;
  }
};

const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Transaction rolled back');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, connect, query, transaction };
