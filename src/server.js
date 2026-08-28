const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const env = require('./config/env');
const { attachUser } = require('./middleware/auth');

const authRoutes = require('./routes/auth.routes');
const meRoutes = require('./routes/me.routes');
const debtsRoutes = require('./routes/debts.routes');
const paymentsRoutes = require('./routes/payments.routes');
const reportsRoutes = require('./routes/reports.routes');
const adminRoutes = require('./routes/admin.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.frontendOrigin, credentials: true }));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

// Si backend/public/index.html existe (frontend copié à côté du backend),
// on le sert directement : un seul déploiement, un seul domaine, aucun
// souci CORS. Sinon le frontend doit être servi/hébergé séparément et
// configurer FRONTEND_ORIGIN + window.SOLVO_API_BASE (voir README).
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
}

app.use(attachUser); // résout req.currentUser depuis le cookie de session (ou null)

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/debts', debtsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

// 404 générique pour toute route API inconnue.
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// Gestion d'erreurs centralisée — ne fuit jamais la stack trace en production.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('Erreur serveur :', err);
  }
  res.status(status).json({
    error: err.message || 'Erreur interne du serveur.',
    code: err.code || 'INTERNAL_ERROR',
  });
});

app.listen(env.port, () => {
  console.log(`Solvo API démarrée sur le port ${env.port} (${env.nodeEnv})`);
});

module.exports = app;
