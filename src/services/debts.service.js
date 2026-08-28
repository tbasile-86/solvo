const { pool, withTransaction } = require('../db/pool');
const { writeAudit } = require('./audit.service');
const { Errors } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

const ALLOWED_TYPES = ['due', 'owed'];
const ALLOWED_STATUS = ['pending', 'partial', 'paid', 'late', 'cancelled'];

async function listDebts(userId, query) {
  const { page, pageSize, offset } = parsePagination(query);
  const conditions = ['user_id = $1', 'deleted_at IS NULL'];
  const params = [userId];

  if (query.type && ALLOWED_TYPES.includes(query.type)) {
    params.push(query.type);
    conditions.push(`type = $${params.length}`);
  }
  if (query.status && ALLOWED_STATUS.includes(query.status)) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.join(' AND ');
  const { rows: countRows } = await pool.query(`SELECT count(*)::int AS n FROM debts WHERE ${where}`, params);
  const { rows } = await pool.query(
    `SELECT d.*, COALESCE(p.paid_amount, 0) AS paid_amount
     FROM debts d
     LEFT JOIN (
       SELECT debt_id, SUM(amount) AS paid_amount FROM payments WHERE deleted_at IS NULL GROUP BY debt_id
     ) p ON p.debt_id = d.id
     WHERE ${where} ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );

  return { items: rows, page, pageSize, total: countRows[0].n };
}

/**
 * Récupère une dette. Le filtre `AND user_id = :userId` est intégré à la
 * requête elle-même : impossible de lire la dette d'un autre utilisateur,
 * même en devinant son id. 0 ligne trouvée => 404 (jamais 403, pour ne pas
 * confirmer l'existence de la ressource à un tiers).
 */
async function getDebtOwned(userId, debtId) {
  const { rows } = await pool.query(
    `SELECT d.*, COALESCE(p.paid_amount, 0) AS paid_amount
     FROM debts d
     LEFT JOIN (
       SELECT debt_id, SUM(amount) AS paid_amount FROM payments WHERE deleted_at IS NULL GROUP BY debt_id
     ) p ON p.debt_id = d.id
     WHERE d.id = $1 AND d.user_id = $2 AND d.deleted_at IS NULL`,
    [debtId, userId]
  );
  if (rows.length === 0) throw Errors.NotFound();
  return rows[0];
}

async function createDebt(userId, payload, ipAddress) {
  const { type, party, amount, currency, dueDate, notes } = payload;
  if (!ALLOWED_TYPES.includes(type)) throw Errors.BadRequest('Type de dette invalide.');
  if (!party || !party.trim()) throw Errors.BadRequest('Le nom du tiers est requis.');
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) throw Errors.BadRequest('Montant invalide.');
  if (!currency || currency.length !== 3) throw Errors.BadRequest('Devise invalide.');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO debts (user_id, type, party, amount, currency, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, type, party.trim(), amountNum, currency.toUpperCase(), dueDate || null, (notes || '').trim() || null]
    );
    const debt = rows[0];
    await writeAudit(client, {
      userId, action: 'debt.create', entityType: 'debt', entityId: debt.id,
      oldValues: null,
      newValues: { amount: debt.amount, currency: debt.currency, party: debt.party, type: debt.type, due_date: debt.due_date },
      ipAddress,
    });
    return debt;
  });
}

async function updateDebt(userId, debtId, payload, ipAddress) {
  return withTransaction(async (client) => {
    const { rows: current } = await client.query(
      `SELECT * FROM debts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [debtId, userId]
    );
    if (current.length === 0) throw Errors.NotFound();
    const before = current[0];

    const party = payload.party !== undefined ? payload.party.trim() : before.party;
    const dueDate = payload.dueDate !== undefined ? payload.dueDate : before.due_date;
    const notes = payload.notes !== undefined ? payload.notes.trim() : before.notes;

    const { rows } = await client.query(
      `UPDATE debts SET party = $1, due_date = $2, notes = $3 WHERE id = $4 RETURNING *`,
      [party, dueDate || null, notes || null, debtId]
    );
    const after = rows[0];

    await writeAudit(client, {
      userId, action: 'debt.update', entityType: 'debt', entityId: debtId,
      oldValues: { party: before.party, due_date: before.due_date, notes: before.notes },
      newValues: { party: after.party, due_date: after.due_date, notes: after.notes },
      ipAddress,
    });
    return after;
  });
}

/**
 * Annulation d'une dette : jamais de DELETE SQL. Passe le statut à
 * 'cancelled' (l'entrée reste visible dans l'historique et auditable).
 */
async function cancelDebt(userId, debtId, ipAddress) {
  return withTransaction(async (client) => {
    const { rows: current } = await client.query(
      `SELECT * FROM debts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [debtId, userId]
    );
    if (current.length === 0) throw Errors.NotFound();
    const before = current[0];

    const { rows } = await client.query(
      `UPDATE debts SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [debtId]
    );

    await writeAudit(client, {
      userId, action: 'debt.cancel', entityType: 'debt', entityId: debtId,
      oldValues: { status: before.status },
      newValues: { status: 'cancelled' },
      ipAddress,
    });
    return rows[0];
  });
}

module.exports = { listDebts, getDebtOwned, createDebt, updateDebt, cancelDebt };
