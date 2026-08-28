const { pool, withTransaction } = require('../db/pool');
const { writeAudit } = require('./audit.service');
const { Errors } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

async function listMembers(query) {
  const { page, pageSize, offset } = parsePagination(query);
  const conditions = ["role = 'member'", 'deleted_at IS NULL'];
  const params = [];
  if (query.status && ['active', 'suspended'].includes(query.status)) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.join(' AND ');

  const { rows: countRows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE ${where}`, params);
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.currency, u.status, u.created_at, u.last_login,
            (SELECT count(*)::int FROM debts WHERE user_id = u.id AND deleted_at IS NULL) AS debts_count
     FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  return { items: rows, page, pageSize, total: countRows[0].n };
}

async function getStats() {
  const { rows: settingsRows } = await pool.query('SELECT setting_value FROM settings WHERE id = 1');
  const settings = settingsRows[0].setting_value;

  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'active') AS active,
       count(*) FILTER (WHERE status = 'suspended') AS suspended,
       count(*) AS total
     FROM users WHERE role = 'member' AND deleted_at IS NULL`
  );
  const total = Number(rows[0].total);

  return {
    total_members: total,
    active_members: Number(rows[0].active),
    suspended_members: Number(rows[0].suspended),
    member_limit: settings.member_limit,
    remaining_slots: Math.max(0, settings.member_limit - total),
    registrations_open: settings.registrations_open !== false && total < settings.member_limit,
  };
}

async function setMemberStatus(adminId, memberId, status, ipAddress) {
  if (!['active', 'suspended'].includes(status)) throw Errors.BadRequest('Statut invalide.');

  return withTransaction(async (client) => {
    const { rows: current } = await client.query(
      `SELECT * FROM users WHERE id = $1 AND role = 'member' AND deleted_at IS NULL FOR UPDATE`,
      [memberId]
    );
    if (current.length === 0) throw Errors.NotFound();
    const before = current[0];

    const { rows } = await client.query(
      `UPDATE users SET status = $1 WHERE id = $2 RETURNING id, name, email, status`,
      [status, memberId]
    );

    await writeAudit(client, {
      userId: adminId,
      action: status === 'suspended' ? 'user.suspend' : 'user.reactivate',
      entityType: 'user',
      entityId: memberId,
      oldValues: { status: before.status },
      newValues: { status },
      ipAddress,
    });

    return rows[0];
  });
}

/**
 * Suppression douce d'un compte abonné : ne supprime jamais ses dettes ni
 * ses paiements. Libère immédiatement une place dans la limite de 500.
 */
async function softDeleteMember(adminId, memberId, ipAddress) {
  return withTransaction(async (client) => {
    const { rows: current } = await client.query(
      `SELECT * FROM users WHERE id = $1 AND role = 'member' AND deleted_at IS NULL FOR UPDATE`,
      [memberId]
    );
    if (current.length === 0) throw Errors.NotFound();

    await client.query(
      `UPDATE users SET deleted_at = now(), status = 'suspended' WHERE id = $1`,
      [memberId]
    );
    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [memberId]);

    await writeAudit(client, {
      userId: adminId, action: 'user.delete', entityType: 'user', entityId: memberId,
      oldValues: { deleted_at: null }, newValues: { deleted_at: new Date().toISOString() },
      ipAddress,
    });
    return { deleted: true };
  });
}

async function updateSettings(adminId, { memberLimit, registrationsOpen }, ipAddress) {
  return withTransaction(async (client) => {
    await client.query('SELECT setting_value FROM settings WHERE id = 1 FOR UPDATE');
    const { rows: before } = await client.query('SELECT setting_value FROM settings WHERE id = 1');
    const beforeValue = before[0].setting_value;

    if (memberLimit !== undefined) {
      const { rows: countRows } = await client.query(
        "SELECT count(*)::int AS n FROM users WHERE role = 'member' AND deleted_at IS NULL"
      );
      if (memberLimit < countRows[0].n) {
        throw Errors.BadRequest(`La limite ne peut pas être inférieure au nombre d'abonnés actuels (${countRows[0].n}).`);
      }
    }

    const newValue = {
      member_limit: memberLimit !== undefined ? memberLimit : beforeValue.member_limit,
      registrations_open: registrationsOpen !== undefined ? registrationsOpen : beforeValue.registrations_open,
    };

    await client.query('UPDATE settings SET setting_value = $1 WHERE id = 1', [JSON.stringify(newValue)]);

    await writeAudit(client, {
      userId: adminId, action: 'settings.update', entityType: 'settings', entityId: null,
      oldValues: beforeValue, newValues: newValue, ipAddress,
    });

    return newValue;
  });
}

module.exports = { listMembers, getStats, setMemberStatus, softDeleteMember, updateSettings };
