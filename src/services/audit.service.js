/**
 * Enregistre une entrée d'audit. `client` doit être le client PostgreSQL
 * de la transaction en cours (jamais le pool directement) : l'audit et
 * l'opération métier doivent réussir ou échouer ensemble.
 */
async function writeAudit(client, {
  userId = null,
  action,
  entityType,
  entityId = null,
  oldValues = null,
  newValues = null,
  ipAddress = null,
}) {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, entityType, entityId, oldValues, newValues, ipAddress]
  );
}

module.exports = { writeAudit };
