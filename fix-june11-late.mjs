/**
 * fix-june11-late.mjs
 * One-time fix for June 11:
 *  - Naveen Kumar (digitalmarketing.iq@outlook.com) and
 *    Soundarya Ramnarayanan (soundaryaram2016@gmail.com)
 *    had late punch-in times recorded — set today's first
 *    'login' event to 9:30 AM IST (04:00 UTC).
 *  - Soundarya also clicked "Finish Day" (logout) by mistake —
 *    remove today's logout event so she shows as Working again.
 *
 * Run on the office laptop with:
 *   node fix-june11-late.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');

const db = new DatabaseSync(DB_PATH);

const todayStr = new Date().toISOString().slice(0, 10); // e.g. 2026-06-11
const CORRECT_LOGIN_TS = `${todayStr}T04:00:00.000Z`;   // 9:30 AM IST

const targets = [
  { email: 'digitalmarketing.iq@outlook.com', name: 'Naveen Kumar', removeLogout: false },
  { email: 'soundaryaram2016@gmail.com',      name: 'Soundarya Ramnarayanan', removeLogout: true },
];

for (const { email, name, removeLogout } of targets) {
  const user = db.prepare(`SELECT id, name FROM users WHERE email = ?`).get(email);
  if (!user) {
    console.log(`❌ User not found: ${email}`);
    continue;
  }

  // Find today's first login event
  const loginRow = db.prepare(`
    SELECT id, timestamp FROM time_logs
    WHERE userId = ? AND type = 'login' AND date(timestamp) = ?
    ORDER BY timestamp ASC LIMIT 1
  `).get(user.id, todayStr);

  if (loginRow) {
    db.prepare(`UPDATE time_logs SET timestamp = ? WHERE id = ?`).run(CORRECT_LOGIN_TS, loginRow.id);
    console.log(`✅ ${name}: login timestamp updated  ${loginRow.timestamp} → ${CORRECT_LOGIN_TS}`);
  } else {
    console.log(`⚠️  ${name}: no login event found for ${todayStr}`);
  }

  if (removeLogout) {
    const logoutRows = db.prepare(`
      SELECT id, timestamp FROM time_logs
      WHERE userId = ? AND type = 'logout' AND date(timestamp) = ?
    `).all(user.id, todayStr);

    for (const row of logoutRows) {
      db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(row.id);
      console.log(`✅ ${name}: removed logout event at ${row.timestamp} (back to Working)`);
    }
    if (logoutRows.length === 0) {
      console.log(`ℹ️  ${name}: no logout event found for ${todayStr}`);
    }
  }
}

db.close();
console.log('\nDone.');
