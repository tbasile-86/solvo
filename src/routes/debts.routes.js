const express = require('express');
const debtsService = require('../services/debts.service');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await debtsService.listDebts(req.currentUser.id, req.query);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const debt = await debtsService.createDebt(req.currentUser.id, req.body || {}, req.ip);
    res.status(201).json({ debt });
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const debt = await debtsService.getDebtOwned(req.currentUser.id, req.params.id);
    res.json({ debt });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const debt = await debtsService.updateDebt(req.currentUser.id, req.params.id, req.body || {}, req.ip);
    res.json({ debt });
  } catch (err) { next(err); }
});

// Annulation (soft) — jamais de suppression physique. Conserve la sémantique
// DELETE côté API pour rester compatible avec un client REST classique.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const debt = await debtsService.cancelDebt(req.currentUser.id, req.params.id, req.ip);
    res.json({ debt });
  } catch (err) { next(err); }
});

module.exports = router;
