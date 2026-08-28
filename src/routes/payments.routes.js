const express = require('express');
const paymentsService = require('../services/payments.service');
const { requireAuth } = require('../middleware/auth');
const { Errors } = require('../utils/errors');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.query.debt_id) throw Errors.BadRequest('Paramètre debt_id requis.');
    const payments = await paymentsService.listPaymentsForDebt(req.currentUser.id, req.query.debt_id);
    res.json({ items: payments });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const payment = await paymentsService.createPayment(req.currentUser.id, {
      debtId: body.debt_id,
      amount: body.amount,
      currency: body.currency,
      paymentDate: body.payment_date,
      paymentMethod: body.payment_method,
      reference: body.reference,
      notes: body.notes,
    }, req.ip);
    res.status(201).json({ payment });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await paymentsService.cancelPayment(req.currentUser.id, req.params.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
