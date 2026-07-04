/**
 * fix-ghosts-june10-july4.mjs
 * For every date June 10 – July 4, 2026 (all employees):
 *  1. Keep only the FIRST login per user per day
 *  2. Delete ALL events that occur AFTER the first logout
 *  3. Delete duplicate logouts (keep first)
 *  4. If NO logout exists, add one at 6:40 PM IST
 *
 * Does NOT touch break/lunch events that fall between login and logout.
 *
 * Run: node fix-ghosts-june10-july4.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

// Build date list: June 10 – July 4 inclusive
const dates = [];
for (
  let d = new Date('2026-06-10T00:00:00Z');
  d.toISOString().slice(0, 10) <= '2026-07-04';
  d.setUTCDate(d.getUTCDate() + 1)
) {
  dates.push(d.toISOString().slice(0, 10));
}
console.log(`Processing ${dates.length} days: ${dates[0]} → ${dates[dates.length - 1]}\n`);

let ghostsRemoved   = 0;
let logoutsAdded    = 0;
let dupsRemoved     = 0;

for (const dayStr of dates) {
  const userIds = db
    .prepare(`SELECT DISTINCT userId FROM time_logs WHERE date(timestamp) = ?`)
    .all(dayStr)
    .map(r => r.userId);

  for (const userId of userIds) {
    const user = db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId);
    const name = user?.name ?? userId;

    const logs = db
      .prepare(
        `SELECT id, type, timestamp FROM time_logs
         WHERE userId = ? AND date(timestamp) = ?
         ORDER BY timestamp ASC`
      )
      .all(userId, dayStr);

    const logins  = logs.filter(l => l.type === 'login');
    const logouts = logs.filter(l => l.type === 'logout');

    if (logins.length === 0) continue; // no login at all — skip

    // 1. Remove duplicate logins (keep only the first)
    if (logins.length > 1) {
      for (const dup of logins.slice(1)) {
        db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(dup.id);
        dupsRemoved++;
        console.log(`🗑  ${dayStr} | ${name}: removed duplicate login @ ${dup.timestamp}`);
      }
    }

    if (logouts.length === 0) {
      // 2. No logout — add one at 6:40 PM IST (13:10 UTC)
      const logoutTs = `${dayStr}T13:10:00.000Z`;
      db.prepare(
        `INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng) VALUES (?,?,?,?,?,NULL,NULL)`
      ).run(randomUUID(), userId, 'logout', logoutTs, 'Auto punch-out 6:40 PM (ghost cleanup)');
      console.log(`✅ ${dayStr} | ${name}: added logout at 6:40 PM IST`);
      logoutsAdded++;
    } else {
      const firstLogout = logouts[0];

      // 3. Delete everything after the first logout (ghost reconnect events)
      const afterLogout = logs.filter(
        l => l.id !== firstLogout.id &&
             new Date(l.timestamp).getTime() > new Date(firstLogout.timestamp).getTime()
      );
      for (const ghost of afterLogout) {
        db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(ghost.id);
        ghostsRemoved++;
        console.log(`🗑  ${dayStr} | ${name}: ghost event [${ghost.type}] @ ${ghost.timestamp}`);
      }

      // 4. Delete extra logouts
      for (const dup of logouts.slice(1)) {
        db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(dup.id);
        dupsRemoved++;
        console.log(`🗑  ${dayStr} | ${name}: extra logout @ ${dup.timestamp}`);
      }
    }
  }
}

db.close();
console.log(`\n══════════════════════════════════════`);
console.log(`Duplicate logins removed : ${dupsRemoved}`);
console.log(`Ghost events removed     : ${ghostsRemoved}`);
console.log(`Logouts added            : ${logoutsAdded}`);
console.log(`Done.`);
