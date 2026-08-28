class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const Errors = {
  BadRequest: (msg) => new AppError(400, 'BAD_REQUEST', msg),
  Unauthorized: (msg = 'Authentification requise.') => new AppError(401, 'UNAUTHORIZED', msg),
  Forbidden: (msg = "Vous n'avez pas accès à cette ressource.") => new AppError(403, 'FORBIDDEN', msg),
  NotFound: (msg = 'Ressource introuvable.') => new AppError(404, 'NOT_FOUND', msg),
  Conflict: (msg) => new AppError(409, 'CONFLICT', msg),
  Locked: (msg) => new AppError(423, 'LOCKED', msg),
  TooMany: (msg = 'Trop de tentatives, réessayez plus tard.') => new AppError(429, 'TOO_MANY_REQUESTS', msg),
};

module.exports = { AppError, Errors };
