const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { Errors } = require('../utils/errors');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const { id, name, email, role, currency } = req.currentUser;
  res.json({ user: { id, name, email, role, currency } });
});

router.put('/', requireAuth, async (req, res, next) => {
  try {
    const { name, currency } = req.body || {};
    if (!name || !name.trim()) throw Errors.BadRequest('Le nom est requis.');
    const { rows } = await pool.query(
      `UPDATE users SET name = $1, currency = COALESCE($2, currency) WHERE id = $3
       RETURNING id, name, email, role, currency`,
      [name.trim(), currency || null, req.currentUser.id]
    );
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
