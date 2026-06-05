/**
 * fix-missing-logouts.mjs
 * One-time script: inserts a logout at 6:40 PM for every employee
 * who punched in on a past day but never punched out.
 *
 * Run with:  node fix-missing-logouts.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');

const db = new DatabaseSync(DB_PATH);

// Get today's date string
const todayStr = new Date().toISOString().slice(0, 10);

// Find all (userId, date) pairs that have a login but no logout — excluding today
const rows = db.prepare(`
  SELECT DISTINCT userId, date(timestamp) as day
  FROM time_logs
  WHERE type = 'login'
    AND date(timestamp) < ?
`).all(todayStr);

let fixed = 0;

for (const row of rows) {
  const { userId, day } = row;

  // Check if there's already a logout on that day for this user
  const hasLogout = db.prepare(`
    SELECT COUNT(*) as c FROM time_logs
    WHERE userId = ? AND type = 'logout' AND date(timestamp) = ?
  `).get(userId, day);

  if (Number(hasLogout.c) > 0) continue; // already has logout, skip

  // Check they actually punched in that day
  const hasLogin = db.prepare(`
    SELECT COUNT(*) as c FROM time_logs
    WHERE userId = ? AND type = 'login' AND date(timestamp) = ?
  `).get(userId, day);

  if (Number(hasLogin.c) === 0) continue;

  // Insert auto-logout at 6:40 PM IST on that day
  // IST = UTC+5:30, so 18:40 IST = 13:10 UTC
  const logoutTs = `${day}T13:10:00.000Z`;
  const id = randomUUID();

  db.prepare(`
    INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng)
    VALUES (?, ?, 'logout', ?, 'Auto punch-out at 6:40 PM (backfill)', NULL, NULL)
  `).run(id, userId, logoutTs);

  console.log(`✅ Fixed: userId=${userId}  date=${day}  logout inserted at 6:40 PM IST`);
  fixed++;
}

console.log(`\nDone — ${fixed} missing logout(s) backfilled.`);
db.close();
