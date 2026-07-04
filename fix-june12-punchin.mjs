/**
 * fix-june12-punchin.mjs
 * For today (June 12, 2026):
 *  - Set everyone's first login to 9:30 AM IST (04:00 UTC),
 *    EXCEPT Sujasree Sridharan (sujasreesridharan.iq@outlook.com)
 *  - For Soundarya Ramnarayanan (soundaryaram2016@gmail.com):
 *      also add a lunch break 1:30 PM - 2:00 PM IST (08:00-08:30 UTC)
 *
 * Run with: node fix-june12-punchin.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

const todayStr = new Date().toISOString().slice(0, 10);
const NEW_LOGIN_TS = `${todayStr}T04:00:00.000Z`; // 9:30 AM IST
const LUNCH_IN_TS  = `${todayStr}T08:00:00.000Z`; // 1:30 PM IST
const LUNCH_OUT_TS = `${todayStr}T08:30:00.000Z`; // 2:00 PM IST

const EXCLUDE_EMAIL = 'sujasreesridharan.iq@outlook.com';
const SOUNDARYA_EMAIL = 'soundaryaram2016@gmail.com';

const users = db.prepare(`SELECT id, name, email FROM users`).all();

let updated = 0;

for (const user of users) {
  if (user.email === EXCLUDE_EMAIL) {
    console.log(`⏭️  ${user.name}: skipped (excluded)`);
    continue;
  }

  const loginRow = db.prepare(`
    SELECT id, timestamp FROM time_logs
    WHERE userId = ? AND type = 'login' AND date(timestamp) = ?
    ORDER BY timestamp ASC LIMIT 1
  `).get(user.id, todayStr);

  if (loginRow) {
    db.prepare(`UPDATE time_logs SET timestamp = ? WHERE id = ?`).run(NEW_LOGIN_TS, loginRow.id);
    console.log(`✅ ${user.name}: login ${loginRow.timestamp} → ${NEW_LOGIN_TS}`);
    updated++;
  } else {
    console.log(`⚠️  ${user.name}: no login found for ${todayStr}, skipped`);
  }

  // Extra: lunch break for Soundarya Ramnarayanan
  if (user.email === SOUNDARYA_EMAIL) {
    db.prepare(`
      DELETE FROM time_logs WHERE userId = ? AND type IN ('lunch_in','lunch_out') AND date(timestamp) = ?
    `).run(user.id, todayStr);

    db.prepare(`
      INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng)
      VALUES (?, ?, 'lunch_in', ?, 'Lunch break (corrected)', NULL, NULL)
    `).run(randomUUID(), user.id, LUNCH_IN_TS);

    db.prepare(`
      INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng)
      VALUES (?, ?, 'lunch_out', ?, 'Back from lunch (corrected)', NULL, NULL)
    `).run(randomUUID(), user.id, LUNCH_OUT_TS);

    console.log(`✅ ${user.name}: lunch break added 1:30 PM – 2:00 PM IST`);
  }
}

db.close();
console.log(`\nDone — ${updated} punch-in time(s) updated.`);
