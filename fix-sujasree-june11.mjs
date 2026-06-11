/**
 * fix-sujasree-june11.mjs
 * One-time fix for June 11 — Sujasree Sridharan (sujasreesridharan.iq@outlook.com):
 *  - Set today's login time to 10:00 AM IST (04:30 UTC)
 *  - Add a lunch break from 3:00 PM to 3:20 PM IST (09:30–09:50 UTC)
 *
 * Run with: node fix-sujasree-june11.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

const todayStr = new Date().toISOString().slice(0, 10);
const LOGIN_TS     = `${todayStr}T04:30:00.000Z`; // 10:00 AM IST
const LUNCH_IN_TS  = `${todayStr}T09:30:00.000Z`; // 3:00 PM IST
const LUNCH_OUT_TS = `${todayStr}T09:50:00.000Z`; // 3:20 PM IST

const email = 'sujasreesridharan.iq@outlook.com';
const user = db.prepare(`SELECT id, name FROM users WHERE email = ?`).get(email);

if (!user) {
  console.log(`❌ User not found: ${email}`);
} else {
  // Fix login time
  const loginRow = db.prepare(`
    SELECT id, timestamp FROM time_logs
    WHERE userId = ? AND type = 'login' AND date(timestamp) = ?
    ORDER BY timestamp ASC LIMIT 1
  `).get(user.id, todayStr);

  if (loginRow) {
    db.prepare(`UPDATE time_logs SET timestamp = ? WHERE id = ?`).run(LOGIN_TS, loginRow.id);
    console.log(`✅ ${user.name}: login timestamp updated  ${loginRow.timestamp} → ${LOGIN_TS}`);
  } else {
    console.log(`⚠️  ${user.name}: no login found, inserting one`);
    db.prepare(`
      INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng)
      VALUES (?, ?, 'login', ?, 'Corrected punch-in time', NULL, NULL)
    `).run(randomUUID(), user.id, LOGIN_TS);
    console.log(`✅ ${user.name}: login inserted at ${LOGIN_TS}`);
  }

  // Remove any existing lunch events today (avoid duplicates) then insert fresh ones
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

  console.log(`✅ ${user.name}: lunch break added 3:00 PM – 3:20 PM IST`);
}

db.close();
console.log('\nDone.');
