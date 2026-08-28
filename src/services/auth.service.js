const argon2 = require('argon2');
const crypto = require('crypto');
const { withTransaction, pool } = require('../db/pool');
const { writeAudit } = require('./audit.service');
const { Errors } = require('../utils/errors');
const env = require('../config/env');

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTS);
}
function verifyPassword(hash, plain) {
  return argon2.verify(hash, plain);
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Inscription d'un abonné. Verrouille la ligne `settings` pour garantir
 * qu'il ne peut jamais y avoir plus de `member_limit` abonnés actifs,
 * même en cas d'inscriptions strictement simultanées.
 */
async function register({ name, email, password, currency }, ipAddress) {
  if (!name || !name.trim()) throw Errors.BadRequest('Le nom est requis.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Errors.BadRequest('Adresse e-mail invalide.');
  if (!password || password.length < 8) throw Errors.BadRequest('Le mot de passe doit contenir au moins 8 caractères.');

  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    // Verrou : sérialise toutes les inscriptions concurrentes.
    await client.query('SELECT setting_value FROM settings WHERE id = 1 FOR UPDATE');

    const { rows: settingsRows } = await client.query('SELECT setting_value FROM settings WHERE id = 1');
    const settings = settingsRows[0].setting_value;
    if (settings.registrations_open === false) {
      throw Errors.Conflict('Les inscriptions sont actuellement complètes.');
    }

    const { rows: countRows } = await client.query(
      "SELECT count(*)::int AS n FROM users WHERE role = 'member' AND deleted_at IS NULL"
    );
    if (countRows[0].n >= settings.member_limit) {
      throw Errors.Conflict('Les inscriptions sont actuellement complètes.');
    }

    const { rows: existing } = await client.query(
      'SELECT id FROM users WHERE lower(email::text) = lower($1) AND deleted_at IS NULL',
      [email]
    );
    if (existing.length > 0) {
      throw Errors.Conflict('Un compte existe déjà avec cet e-mail.');
    }

    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, status, currency)
       VALUES ($1, $2, $3, 'member', 'active', $4)
       RETURNING id, name, email, role, status, currency, created_at`,
      [name.trim(), email.toLowerCase(), passwordHash, currency || 'XAF']
    );
    const user = rows[0];
    // Remarque : la création de compte n'est pas dans la liste des actions
    // auditées (§6 de l'architecture, centrée sur les opérations financières
    // et les changements de statut). Ajouter 'user.create' à la contrainte
    // CHECK de audit_logs si vous souhaitez également la tracer.

    return user;
  });
}

/**
 * Connexion : vérifie le mot de passe, la protection brute-force, le statut
 * du compte, puis crée une session serveur (jeton haché en base).
 */
async function login({ email, password }, ipAddress, userAgent) {
  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash, role, status, currency, failed_login_count, locked_until, deleted_at
     FROM users WHERE lower(email::text) = lower($1)`,
    [email || '']
  );
  const user = rows[0];

  // Réponse volontairement générique si le compte n'existe pas (pas de fuite d'information).
  if (!user || user.deleted_at) {
    throw Errors.Unauthorized('E-mail ou mot de passe incorrect.');
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw Errors.Locked('Compte temporairement verrouillé suite à plusieurs échecs. Réessayez plus tard.');
  }

  const valid = await verifyPassword(user.password_hash, password || '');

  if (!valid) {
    await withTransaction(async (client) => {
      const attempts = user.failed_login_count + 1;
      const shouldLock = attempts >= env.login.maxAttempts;
      await client.query(
        `UPDATE users SET failed_login_count = $1,
                locked_until = CASE WHEN $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
         WHERE id = $4`,
        [attempts, shouldLock, env.login.lockMinutes, user.id]
      );
      await writeAudit(client, { userId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, ipAddress });
    });
    throw Errors.Unauthorized('E-mail ou mot de passe incorrect.');
  }

  if (user.status === 'suspended') {
    throw Errors.Forbidden('Ce compte est suspendu. Contactez l’administrateur.');
  }

  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + env.session.absoluteDays * 86400000);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login = now() WHERE id = $1`,
      [user.id]
    );
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokenHash, ipAddress, userAgent, expiresAt]
    );
    await writeAudit(client, { userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ipAddress });
  });

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, currency: user.currency },
  };
}

async function logout(sessionId) {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
}

/**
 * Résout une session à partir du jeton brut envoyé par le client.
 * Vérifie expiration absolue, expiration glissante (inactivité) et révocation.
 * Rejette aussi si le compte est suspendu ou soft-supprimé depuis la création de la session.
 */
async function resolveSession(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at, s.last_seen_at,
            u.id, u.name, u.email, u.role, u.status, u.currency, u.deleted_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  const idleLimit = new Date(Date.now() - env.session.idleDays * 86400000);
  if (new Date(row.last_seen_at) < idleLimit) return null;
  if (row.status === 'suspended' || row.deleted_at) return null;

  // Expiration glissante : on touche last_seen_at (sans bloquer la requête).
  pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]).catch(() => {});

  return {
    sessionId: row.session_id,
    id: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    currency: row.currency,
  };
}

module.exports = { register, login, logout, resolveSession, hashPassword, verifyPassword };
