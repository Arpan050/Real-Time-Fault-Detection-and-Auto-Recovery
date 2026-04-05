'use strict';

const db = require('../config/database');
const logger = require('../config/logger');

class UserRepository {
  async findAll({ limit = 20, offset = 0, status, search } = {}) {
    let query = `
      SELECT id, username, email, full_name, status, metadata, created_at, updated_at
      FROM users
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (username ILIKE $${params.length} OR email ILIKE $${params.length} OR full_name ILIKE $${params.length})`;
    }

    params.push(limit, offset);
    query += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  async count({ status, search } = {}) {
    let query = 'SELECT COUNT(*) FROM users WHERE 1=1';
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (username ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    const result = await db.query(query, params);
    return parseInt(result.rows[0].count);
  }

  async findById(id) {
    const result = await db.query(
      'SELECT id, username, email, full_name, status, metadata, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async findByEmail(email) {
    const result = await db.query(
      'SELECT id, username, email, full_name, status, metadata, created_at, updated_at FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] || null;
  }

  async create({ username, email, full_name, metadata = {} }) {
    return db.transaction(async (client) => {
      const userResult = await client.query(
        `INSERT INTO users (username, email, full_name, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, email, full_name, status, metadata, created_at, updated_at`,
        [username, email, full_name, JSON.stringify(metadata)]
      );

      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO user_audit_log (user_id, action, new_values, performed_by)
         VALUES ($1, 'CREATE', $2, $3)`,
        [user.id, JSON.stringify(user), 'system']
      );

      return user;
    });
  }

  async update(id, updates) {
    const existing = await this.findById(id);
    if (!existing) return null;

    const allowedFields = ['username', 'email', 'full_name', 'status', 'metadata'];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined) {
        params.push(key === 'metadata' ? JSON.stringify(value) : value);
        setClauses.push(`${key} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) return existing;

    params.push(id);

    return db.transaction(async (client) => {
      const result = await client.query(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${params.length}
         RETURNING id, username, email, full_name, status, metadata, created_at, updated_at`,
        params
      );

      const updated = result.rows[0];

      await client.query(
        `INSERT INTO user_audit_log (user_id, action, old_values, new_values, performed_by)
         VALUES ($1, 'UPDATE', $2, $3, $4)`,
        [id, JSON.stringify(existing), JSON.stringify(updated), 'system']
      );

      return updated;
    });
  }

  async delete(id) {
    const existing = await this.findById(id);
    if (!existing) return false;

    return db.transaction(async (client) => {
      await client.query(
        `INSERT INTO user_audit_log (user_id, action, old_values, performed_by)
         VALUES ($1, 'DELETE', $2, $3)`,
        [id, JSON.stringify(existing), 'system']
      );

      await client.query('DELETE FROM users WHERE id = $1', [id]);
      return true;
    });
  }

  async countActiveUsers() {
    const result = await db.query("SELECT COUNT(*) FROM users WHERE status = 'active'");
    return parseInt(result.rows[0].count);
  }
}

module.exports = new UserRepository();
