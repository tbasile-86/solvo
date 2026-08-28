/**
 * Crée (ou met à jour le mot de passe d') le compte administrateur unique,
 * à partir des variables d'environnement ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * Usage : npm run create-admin
 *
 * Aucun identifiant admin n'existe jamais en clair dans le code source ou en
 * base : le mot de passe est haché ici avant toute écriture SQL.
 */
require('dotenv').config();
const { pool } = require('../db/pool');
const { hashPassword } = require('../services/auth.service');

async function main() {
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password) {
    console.error('ADMIN_NAME, ADMIN_EMAIL et ADMIN_PASSWORD doivent être définis dans .env');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Le mot de passe administrateur doit contenir au moins 12 caractères.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const { rows: existing } = await pool.query(
    `SELECT id FROM users WHERE lower(email::text) = lower($1)`,
    [email]
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE users SET password_hash = $1, name = $2, role = 'admin', status = 'active', deleted_at = NULL WHERE id = $3`,
      [passwordHash, name, existing[0].id]
    );
    console.log(`Compte administrateur mis à jour : ${email}`);
  } else {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, status)
       VALUES ($1, $2, $3, 'admin', 'active')`,
      [name, email.toLowerCase(), passwordHash]
    );
    console.log(`Compte administrateur créé : ${email}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
