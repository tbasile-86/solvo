const { Pool } = require('pg');
const env = require('../config/env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Une connexion inactive du pool part en erreur : on log sans faire planter le process.
  console.error('Erreur inattendue sur une connexion PostgreSQL du pool :', err);
});

/**
 * Exécute `fn` à l'intérieur d'une transaction SQL.
 * `fn` reçoit un client PostgreSQL et doit utiliser client.query(...).
 * Rollback automatique si `fn` lève une exception.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
