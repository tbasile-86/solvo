require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: required('DATABASE_URL'),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  session: {
    absoluteDays: parseInt(process.env.SESSION_ABSOLUTE_DAYS || '30', 10),
    idleDays: parseInt(process.env.SESSION_IDLE_DAYS || '7', 10),
  },
  login: {
    maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10),
    lockMinutes: parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10),
  },
};
