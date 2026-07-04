/**
 * fix-all-missing-logouts.mjs
 * For every past date (June 1 to yesterday):
 *  1. Keeps only the FIRST login per user per day
 *  2. Adds a 6:40 PM IST logout if none exists
 *  3. Deletes ALL events after the first logout (ghost reconnects)
 *  4. Deletes duplicate logouts
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

const yesterday = new Date();
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const yesterdayStr = yesterday.toISOString().slice(0, 10);

const dates = [];
for (let d = new Date('2026-06-01T00:00:00Z'); d.toISOString().slice(0,10) <= yesterdayStr; d.setUTCDate(d.getUTCDate() + 1)) {
  dates.push(d.toISOString().slice(0, 10));
}

console.log(`Processing ${dates.length} days: ${dates[0]} → ${dates[dates.length-1]}\n`);

let totalLogoutsAdded = 0;
let totalGhostsRemoved = 0;

for (const dayStr of dates) {
  const userIds = db.prepare(`SELECT DISTINCT userId FROM time_logs WHERE date(timestamp) = ?`).all(dayStr).map(r => r.userId);

  for (const userId of userIds) {
    const user = db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId);
    const logs = db.prepare(`
      SELECT id, type, timestamp FROM time_logs
      WHERE userId = ? AND date(timestamp) = ?
      ORDER BY timestamp ASC
    `).all(userId, dayStr);

    const logins  = logs.filter(l => l.type === 'login');
    const logouts = logs.filter(l => l.type === 'logout');

    if (logins.length === 0) continue; // no login at all, skip

    // 1. Remove duplicate logins (keep first)
    if (logins.length > 1) {
      for (const dup of logins.slice(1)) {
        db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(dup.id);
        totalGhostsRemoved++;
      }
    }

    // 2. Add logout at 6:40 PM IST if missing
    if (logouts.length === 0) {
      const LOGOUT_TS = `${dayStr}T13:10:00.000Z`; // 6:40 PM IST
      db.prepare(`INSERT INTO time_logs (id,userId,type,timestamp,note,lat,lng) VALUES (?,?,?,?,?,NULL,NULL)`)
        .run(randomUUID(), userId, 'logout', LOGOUT_TS, 'Auto punch-out 6:40 PM (backfill)');
      console.log(`✅ ${dayStr} | ${user?.name}: logout added at 6:40 PM IST`);
      totalLogoutsAdded++;
    } else {
      // 3. Keep first logout, delete everything after it
      const firstLogout = logouts[0];
      const afterLogout = logs.filter(l =>
        l.id !== firstLogout.id &&
        new Date(l.timestamp).getTime() > new Date(firstLogout.timestamp).getTime()
      );
      for (const ghost of afterLogout) {
        db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(ghost.id);
        totalGhostsRemoved++;
      }
      // 4. Delete extra logouts
      for (const dup of logouts.slice(1)) {
        db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(dup.id);
        totalGhostsRemoved++;
      }
    }
  }
}

db.close();
console.log(`\n══════════════════════════════════`);
console.log(`Logouts added:    ${totalLogoutsAdded}`);
console.log(`Ghost events removed: ${totalGhostsRemoved}`);
console.log(`Done.`);
