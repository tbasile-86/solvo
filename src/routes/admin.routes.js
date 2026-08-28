const express = require('express');
const adminService = require('../services/admin.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/users', async (req, res, next) => {
  try {
    const result = await adminService.listMembers(req.query);
    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const user = await adminService.setMemberStatus(req.currentUser.id, req.params.id, req.body.status, req.ip);
    res.json({ user });
  } catch (err) { next(err); }
});

// Suppression douce uniquement — voir §4 de l'architecture.
router.delete('/users/:id', async (req, res, next) => {
  try {
    const result = await adminService.softDeleteMember(req.currentUser.id, req.params.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await adminService.getStats();
    res.json(stats);
  } catch (err) { next(err); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const { member_limit, registrations_open } = req.body || {};
    const settings = await adminService.updateSettings(req.currentUser.id, {
      memberLimit: member_limit,
      registrationsOpen: registrations_open,
    }, req.ip);
    res.json({ settings });
  } catch (err) { next(err); }
});

module.exports = router;
