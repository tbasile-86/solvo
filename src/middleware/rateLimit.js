const rateLimit = require('express-rate-limit');

// Limite par IP sur les routes sensibles d'authentification.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes, réessayez plus tard.' },
});

module.exports = { authLimiter, passwordResetLimiter };
