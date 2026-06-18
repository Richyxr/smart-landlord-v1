import pg from 'pg';

const { Pool } = pg;

const JSON_COLUMNS = new Set([
  'raw_payload',
  'raw_row_data',
  'transaction_snapshot',
  'old_values',
  'new_values',
  'metadata',
  'bank_account_details'
]);

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for PostgreSQL runtime access.');
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
}

function quoteIdent(identifier) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function normalizeValue(column, value) {
  if (!JSON_COLUMNS.has(column) || value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return value;
    }
  }

  return value;
}

function buildWhere(filterObj = {}, startIndex = 1) {
  const clauses = [];
  const values = [];
  let index = startIndex;

  for (const [key, value] of Object.entries(filterObj)) {
    const column = quoteIdent(key);
    if (value === null) {
      clauses.push(`${column} IS NULL`);
      continue;
    }

    clauses.push(`${column} = $${index}`);
    values.push(normalizeValue(key, value));
    index += 1;
  }

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
    nextIndex: index
  };
}

export function createPostgresDb() {
  const pool = createPool();

  return {
    pool,

    async query(sql, params = []) {
      return pool.query(sql, params);
    },

    async get(table) {
      const result = await pool.query(`SELECT * FROM ${quoteIdent(table)} ORDER BY id`);
      return result.rows;
    },

    async find(table, filterObj) {
      const where = buildWhere(filterObj);
      const result = await pool.query(
        `SELECT * FROM ${quoteIdent(table)} ${where.clause} ORDER BY id`,
        where.values
      );
      return result.rows;
    },

    async findOne(table, filterObj) {
      const where = buildWhere(filterObj);
      const result = await pool.query(
        `SELECT * FROM ${quoteIdent(table)} ${where.clause} ORDER BY id LIMIT 1`,
        where.values
      );
      return result.rows[0] || null;
    },

    async insert(table, rowData) {
      const entries = Object.entries(rowData || {}).filter(([, value]) => value !== undefined);
      const columns = entries.map(([key]) => quoteIdent(key));
      const values = entries.map(([key, value]) => normalizeValue(key, value));
      const placeholders = values.map((_, index) => `$${index + 1}`);

      const result = await pool.query(
        `
          INSERT INTO ${quoteIdent(table)} (${columns.join(', ')})
          VALUES (${placeholders.join(', ')})
          RETURNING *
        `,
        values
      );

      return result.rows[0];
    },

    async update(table, query, updates) {
      const updateEntries = Object.entries(updates || {}).filter(([, value]) => value !== undefined);
      if (updateEntries.length === 0) return [];

      const setParts = [];
      const values = [];
      let index = 1;

      for (const [key, value] of updateEntries) {
        setParts.push(`${quoteIdent(key)} = $${index}`);
        values.push(normalizeValue(key, value));
        index += 1;
      }

      if (!('updated_at' in updates)) {
        setParts.push('updated_at = now()');
      }

      const filterObj = (typeof query === 'number' || (typeof query === 'string' && /^\d+$/.test(query)))
        ? { id: parseInt(query, 10) }
        : query;
      const where = buildWhere(filterObj, index);

      const result = await pool.query(
        `
          UPDATE ${quoteIdent(table)}
          SET ${setParts.join(', ')}
          ${where.clause}
          RETURNING *
        `,
        [...values, ...where.values]
      );

      return result.rows;
    },

    async delete(table, query) {
      const filterObj = (typeof query === 'number' || (typeof query === 'string' && /^\d+$/.test(query)))
        ? { id: parseInt(query, 10) }
        : query;
      const where = buildWhere(filterObj);
      const result = await pool.query(
        `DELETE FROM ${quoteIdent(table)} ${where.clause}`,
        where.values
      );
      return result.rowCount > 0;
    },

    async logError(orgId, userId, source, message, stack = null, metadata = {}) {
      return this.insert('system_errors', {
        organization_id: orgId,
        user_id: userId,
        source,
        severity: 'error',
        message,
        stack_trace: stack,
        metadata,
        status: 'open'
      });
    },

    async logAudit(orgId, actorUserId, actorRole, actionType, targetType, targetId, oldValues = null, newValues = null, reason = '', pinValidated = null) {
      return this.insert('audit_logs', {
        organization_id: orgId,
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId,
        old_values: oldValues,
        new_values: newValues,
        pin_validation_status: pinValidated,
        reason,
        metadata: { ip: '127.0.0.1', device: 'Mobile Admin Web' }
      });
    },

    async close() {
      await pool.end();
    }
  };
}
