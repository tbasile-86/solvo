const { pool, withTransaction } = require('../db/pool');
const { writeAudit } = require('./audit.service');
const { Errors } = require('../utils/errors');

/** Recalcule le statut d'une dette à partir de son solde restant et de son échéance. */
function computeStatus(amount, paid, dueDate) {
  const remaining = Number(amount) - Number(paid);
  if (remaining <= 0) return 'paid';
  if (dueDate && new Date(dueDate) < new Date(new Date().toDateString())) return 'late';
  if (Number(paid) > 0) return 'partial';
  return 'pending';
}

async function listPaymentsForDebt(userId, debtId) {
  const { rows: debtRows } = await pool.query(
    `SELECT id FROM debts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [debtId, userId]
  );
  if (debtRows.length === 0) throw Errors.NotFound();

  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE debt_id = $1 AND deleted_at IS NULL ORDER BY payment_date DESC, created_at DESC`,
    [debtId]
  );
  return rows;
}

/**
 * Enregistre un paiement. Verrouille la ligne de la dette (`FOR UPDATE`) pour
 * la durée de la transaction : deux paiements simultanés sur la même dette
 * sont sérialisés, le second relit le total réellement payé avant de valider
 * son propre montant — aucun dépassement de solde possible même sous
 * concurrence. La devise est en outre garantie identique par le trigger
 * PostgreSQL `enforce_payment_currency` (défense en profondeur).
 */
async function createPayment(userId, payload, ipAddress) {
  const { debtId, amount, currency, paymentDate, paymentMethod, reference, notes } = payload;
  const amountNum = Number(amount);
  if (!debtId) throw Errors.BadRequest('Identifiant de dette requis.');
  if (!Number.isFinite(amountNum) || amountNum <= 0) throw Errors.BadRequest('Montant invalide.');

  return withTransaction(async (client) => {
    const { rows: debtRows } = await client.query(
      `SELECT * FROM debts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [debtId, userId]
    );
    if (debtRows.length === 0) throw Errors.NotFound();
    const debt = debtRows[0];

    if (debt.status === 'cancelled') {
      throw Errors.BadRequest('Impossible d’enregistrer un paiement sur une dette annulée.');
    }

    if (currency && currency.toUpperCase() !== debt.currency) {
      // Vérification applicative précoce, avant même d'atteindre le trigger SQL,
      // pour renvoyer un message clair au frontend.
      throw Errors.BadRequest(
        `La devise du paiement (${currency}) doit correspondre à celle de la dette (${debt.currency}). Aucune conversion implicite n’est autorisée.`
      );
    }

    const { rows: paidRows } = await client.query(
      `SELECT COALESCE(sum(amount), 0) AS paid FROM payments WHERE debt_id = $1 AND deleted_at IS NULL`,
      [debtId]
    );
    const alreadyPaid = Number(paidRows[0].paid);
    const remaining = Number(debt.amount) - alreadyPaid;

    if (amountNum > remaining + 0.0001) {
      throw Errors.BadRequest(`Montant supérieur au solde restant (${remaining.toFixed(2)} ${debt.currency}).`);
    }

    const { rows: paymentRows } = await client.query(
      `INSERT INTO payments (debt_id, user_id, amount, currency, payment_date, payment_method, reference, notes)
       VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8) RETURNING *`,
      [debtId, userId, amountNum, debt.currency, paymentDate || null, paymentMethod || null, reference || null, (notes || '').trim() || null]
    );
    const payment = paymentRows[0];

    const newPaid = alreadyPaid + amountNum;
    const newStatus = computeStatus(debt.amount, newPaid, debt.due_date);
    await client.query(`UPDATE debts SET status = $1 WHERE id = $2`, [newStatus, debtId]);

    await writeAudit(client, {
      userId, action: 'payment.create', entityType: 'payment', entityId: payment.id,
      oldValues: null,
      newValues: { amount: payment.amount, currency: payment.currency, payment_date: payment.payment_date, debt_id: debtId },
      ipAddress,
    });

    return payment;
  });
}

/**
 * Annulation d'un paiement : soft delete (`deleted_at`), jamais de DELETE SQL.
 * Le solde de la dette est recalculé en excluant ce paiement, comme s'il
 * n'avait jamais existé — mais la ligne demeure pour l'historique et l'audit.
 */
async function cancelPayment(userId, paymentId, ipAddress) {
  return withTransaction(async (client) => {
    const { rows: paymentRows } = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [paymentId, userId]
    );
    if (paymentRows.length === 0) throw Errors.NotFound();
    const payment = paymentRows[0];

    const { rows: debtRows } = await client.query(
      `SELECT * FROM debts WHERE id = $1 FOR UPDATE`,
      [payment.debt_id]
    );
    const debt = debtRows[0];

    await client.query(`UPDATE payments SET deleted_at = now() WHERE id = $1`, [paymentId]);

    const { rows: paidRows } = await client.query(
      `SELECT COALESCE(sum(amount), 0) AS paid FROM payments WHERE debt_id = $1 AND deleted_at IS NULL`,
      [debt.id]
    );
    const newStatus = computeStatus(debt.amount, Number(paidRows[0].paid), debt.due_date);
    await client.query(`UPDATE debts SET status = $1 WHERE id = $2`, [newStatus, debt.id]);

    await writeAudit(client, {
      userId, action: 'payment.cancel', entityType: 'payment', entityId: paymentId,
      oldValues: { deleted_at: null },
      newValues: { deleted_at: new Date().toISOString() },
      ipAddress,
    });

    return { cancelled: true };
  });
}

module.exports = { listPaymentsForDebt, createPayment, cancelPayment, computeStatus };
