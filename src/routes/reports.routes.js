const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser.id;

    const { rows: totals } = await pool.query(
      `SELECT type,
              COALESCE(sum(amount), 0) AS total,
              COALESCE(sum(amount) FILTER (WHERE status <> 'paid'), 0) AS remaining_pending
       FROM debts WHERE user_id = $1 AND deleted_at IS NULL AND status <> 'cancelled'
       GROUP BY type`,
      [userId]
    );

    const { rows: byStatus } = await pool.query(
      `SELECT status, count(*)::int AS n FROM debts
       WHERE user_id = $1 AND deleted_at IS NULL GROUP BY status`,
      [userId]
    );

    // Solde restant réel : montant - paiements actifs, par dette non annulée.
    const { rows: remaining } = await pool.query(
      `SELECT d.type, COALESCE(SUM(d.amount - COALESCE(p.paid, 0)), 0) AS remaining
       FROM debts d
       LEFT JOIN (
         SELECT debt_id, SUM(amount) AS paid FROM payments WHERE deleted_at IS NULL GROUP BY debt_id
       ) p ON p.debt_id = d.id
       WHERE d.user_id = $1 AND d.deleted_at IS NULL AND d.status NOT IN ('cancelled')
       GROUP BY d.type`,
      [userId]
    );

    res.json({ totals, by_status: byStatus, remaining_by_type: remaining });
  } catch (err) { next(err); }
});

module.exports = router;
