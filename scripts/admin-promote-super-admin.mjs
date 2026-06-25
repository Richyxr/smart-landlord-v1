#!/usr/bin/env node
import { db } from '../server/db.js';
import { createPostgresDb } from '../server/postgresDb.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--email') {
      args.email = argv[i + 1];
      i += 1;
    } else if (token === '--reason') {
      args.reason = argv[i + 1];
      i += 1;
    } else if (token === '--actor-user-id') {
      args.actorUserId = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function main() {
  const args = parseArgs(process.argv);
  const email = normalizeEmail(args.email);

  if (!email) {
    console.error('Usage: node scripts/admin-promote-super-admin.mjs --email <email> [--reason <text>] [--actor-user-id <id>] [--dry-run]');
    process.exit(1);
  }

  const actorUserId = Number.isInteger(args.actorUserId) ? args.actorUserId : null;
  const reason = args.reason || 'Manual role promotion to super_admin';

  let pgDb = null;
  const usePostgres = Boolean(process.env.DATABASE_URL);

  try {
    if (usePostgres) {
      pgDb = createPostgresDb();
    }

    const activeFindOne = (table, filterObj) => (pgDb ? pgDb.findOne(table, filterObj) : db.findOne(table, filterObj));
    const activeUpdate = (table, idOrFilter, updates) => (pgDb ? pgDb.update(table, idOrFilter, updates) : db.update(table, idOrFilter, updates));
    const activeInsert = (table, rowData) => (pgDb ? pgDb.insert(table, rowData) : db.insert(table, rowData));

    const user = await activeFindOne('users', { email });
    if (!user) {
      console.error(`User not found for email: ${email}`);
      process.exit(2);
    }

    const primaryMembership = await activeFindOne('organization_members', { user_id: user.id, status: 'active' });
    const organization = primaryMembership
      ? await activeFindOne('organizations', { id: primaryMembership.organization_id })
      : null;

    if (user.is_super_admin === true) {
      console.log(JSON.stringify({
        ok: true,
        message: 'User is already super_admin',
        user_id: user.id,
        email,
        organization_id: organization ? organization.id : null,
        dry_run: Boolean(args.dryRun)
      }, null, 2));
      return;
    }

    const oldValues = {
      is_super_admin: Boolean(user.is_super_admin),
      role_hint: primaryMembership ? primaryMembership.role : null
    };
    const newValues = {
      is_super_admin: true,
      role_hint: 'super_admin'
    };

    if (args.dryRun) {
      console.log(JSON.stringify({
        ok: true,
        message: 'Dry-run: no changes applied',
        user_id: user.id,
        email,
        organization_id: organization ? organization.id : null,
        old_values: oldValues,
        new_values: newValues,
        reason
      }, null, 2));
      return;
    }

    const updatedRows = await activeUpdate('users', user.id, { is_super_admin: true });
    const updatedUser = Array.isArray(updatedRows) ? updatedRows[0] : null;

    if (!updatedUser || updatedUser.is_super_admin !== true) {
      console.error('Promotion failed: user record was not updated as expected.');
      process.exit(3);
    }

    await activeInsert('audit_logs', {
      organization_id: organization ? organization.id : null,
      actor_user_id: actorUserId,
      actor_role: 'super_admin',
      action_type: 'promote_super_admin',
      target_type: 'user',
      target_id: user.id,
      old_values: oldValues,
      new_values: newValues,
      reason,
      metadata: { email }
    });

    await activeInsert('system_audit_logs', {
      admin_user_id: actorUserId,
      target_organization_id: organization ? organization.id : null,
      action: 'promote_user_to_super_admin',
      reason,
      metadata: { email, user_id: user.id }
    });

    console.log(JSON.stringify({
      ok: true,
      message: 'User promoted to super_admin',
      user_id: user.id,
      email,
      organization_id: organization ? organization.id : null,
      actor_user_id: actorUserId,
      reason
    }, null, 2));
  } finally {
    if (pgDb) {
      await pgDb.close();
    }
  }
}

main().catch(error => {
  console.error('Promotion script failed:', error.message);
  process.exit(99);
});
