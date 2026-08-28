const { resolveSession } = require('../services/auth.service');
const { Errors } = require('../utils/errors');

const COOKIE_NAME = 'solvo_session';

/**
 * Résout req.currentUser exclusivement à partir du cookie de session.
 * Ne lit JAMAIS un user_id envoyé dans le body, l'URL ou un header custom :
 * c'est la garantie de base de l'isolation des données (voir §7 architecture).
 */
async function attachUser(req, res, next) {
  try {
    const rawToken = req.cookies ? req.cookies[COOKIE_NAME] : null;
    const user = await resolveSession(rawToken);
    req.currentUser = user; // peut être null si non authentifié
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.currentUser) return next(Errors.Unauthorized());
  next();
}

module.exports = { attachUser, requireAuth, COOKIE_NAME };
