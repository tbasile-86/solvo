const express = require('express');
const adminService = require('../services/admin.service');

const router = express.Router();

// Route volontairement non authentifiée : n'expose que des compteurs globaux
// (places restantes, inscriptions ouvertes/fermées), utile pour la page
// d'accueil publique. Aucune donnée nominative ou financière n'y transite.
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await adminService.getStats();
    res.json({
      member_limit: stats.member_limit,
      remaining_slots: stats.remaining_slots,
      registrations_open: stats.registrations_open,
    });
  } catch (err) { next(err); }
});

module.exports = router;
