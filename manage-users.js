/**
 * manage-users.js — manage the dashboard's Google-OAuth allowlist.
 *
 * The dashboard only lets in Google accounts whose email is in the
 * `allowed_users` table. Use this to add/remove/list those emails.
 *
 * Reads DB_PATH from the environment (on Fly that's /data/alerts.db), so run it
 * inside the app environment:
 *
 *   fly ssh console -C "node /app/manage-users.js list"
 *   fly ssh console -C "node /app/manage-users.js add jane@example.com 'Jane Doe'"
 *   fly ssh console -C "node /app/manage-users.js remove jane@example.com"
 *
 * Locally:  npm run user:list  |  npm run user:add -- jane@example.com "Jane Doe"
 */

import {
  initDatabase,
  addAllowedUser,
  getAllowedUsers,
  removeAllowedUser,
  isEmailAllowed
} from './db/database.js';

function printList() {
  const users = getAllowedUsers();
  if (!users.length) {
    console.log('  (allowlist is empty)');
    return;
  }
  console.log(`  ${users.length} allowed user(s):`);
  for (const u of users) {
    console.log(`   • ${u.email}${u.name ? `  (${u.name})` : ''}`);
  }
}

const USAGE = [
  'Usage:',
  '  node manage-users.js list',
  '  node manage-users.js add <email> [full name]',
  '  node manage-users.js remove <email>'
].join('\n');

function main() {
  const [cmd, email, ...nameParts] = process.argv.slice(2);
  initDatabase();

  switch (cmd) {
    case 'list':
      printList();
      break;

    case 'add':
      if (!email) { console.error(USAGE); process.exit(1); }
      if (isEmailAllowed(email)) {
        console.log(`✓ ${email} is already on the allowlist — nothing to do.`);
      } else {
        addAllowedUser({ email, name: nameParts.join(' ') || null, added_by: 'cli' });
        console.log(`✓ Added ${email} to the dashboard allowlist.`);
      }
      printList();
      break;

    case 'remove':
      if (!email) { console.error(USAGE); process.exit(1); }
      {
        const res = removeAllowedUser(email);
        console.log(res.changes ? `✓ Removed ${email}.` : `– ${email} was not on the allowlist.`);
      }
      printList();
      break;

    default:
      console.error(USAGE);
      process.exit(1);
  }
}

main();
