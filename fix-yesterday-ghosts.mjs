/**
 * fix-yesterday-ghosts.mjs
 * Cleans up ghost login/logout events from YESTERDAY for every user:
 *  - Keeps only the FIRST 'login' of the day (deletes duplicate ghost logins)
 *  - Keeps only the FIRST 'logout' after that login
 *  - Deletes ANY event (of any type) timestamped AFTER that first logout
 *    (these are ghost re-connect events causing 25+ hour totals)
 *
 * Run with: node fix-yesterday-ghosts.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

// Yesterday's date (UTC)
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const dayStr = yesterday.toISOString().slice(0, 10);

console.log(`Cleaning ghost events for: ${dayStr}\n`);

const userIds = db.prepare(`
  SELECT DISTINCT userId FROM time_logs WHERE date(timestamp) = ?
`).all(dayStr).map(r => r.userId);

let totalDeleted = 0;

for (const userId of userIds) {
  const user = db.prepare(`SELECT name, email FROM users WHERE id = ?`).get(userId);
  const logs = db.prepare(`
    SELECT id, type, timestamp FROM time_logs
    WHERE userId = ? AND date(timestamp) = ?
    ORDER BY timestamp ASC
  `).all(userId, dayStr);

  if (logs.length === 0) continue;

  const logins  = logs.filter(l => l.type === 'login');
  const logouts = logs.filter(l => l.type === 'logout');

  let deletedForUser = 0;

  // 1. Delete duplicate logins (keep only the first)
  if (logins.length > 1) {
    for (const dup of logins.slice(1)) {
      db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(dup.id);
      deletedForUser++;
    }
  }

  // 2. If there's at least one logout, keep the FIRST logout and delete
  //    everything (any type) after it
  if (logouts.length > 0) {
    const firstLogout = logouts[0];
    const afterLogout = logs.filter(l =>
      l.id !== firstLogout.id &&
      new Date(l.timestamp).getTime() > new Date(firstLogout.timestamp).getTime()
    );
    for (const ghost of afterLogout) {
      db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(ghost.id);
      deletedForUser++;
    }
    // Also delete any extra logouts (keep only the first)
    for (const dup of logouts.slice(1)) {
      db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(dup.id);
      deletedForUser++;
    }
  }

  if (deletedForUser > 0) {
    console.log(`✅ ${user?.name ?? userId}: removed ${deletedForUser} ghost event(s)`);
    totalDeleted += deletedForUser;
  }
}

db.close();
console.log(`\nDone — ${totalDeleted} ghost event(s) removed for ${dayStr}.`);
