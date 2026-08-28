const { Errors } = require('../utils/errors');

function requireRole(role) {
  return (req, res, next) => {
    if (!req.currentUser) return next(Errors.Unauthorized());
    if (req.currentUser.role !== role) return next(Errors.Forbidden());
    next();
  };
}

module.exports = { requireRole };
