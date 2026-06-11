/**
 * fix-naveen-soundarya-lunch.mjs
 * Add lunch break 2:00 PM – 2:20 PM IST (08:30–08:50 UTC) for today
 * to Naveen Kumar and Soundarya Ramnarayanan.
 *
 * Run with: node fix-naveen-soundarya-lunch.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

const todayStr = new Date().toISOString().slice(0, 10);
const LUNCH_IN_TS  = `${todayStr}T08:30:00.000Z`; // 2:00 PM IST
const LUNCH_OUT_TS = `${todayStr}T08:50:00.000Z`; // 2:20 PM IST

const emails = [
  'digitalmarketing.iq@outlook.com',  // Naveen Kumar
  'soundaryaram2016@gmail.com',       // Soundarya Ramnarayanan
];

for (const email of emails) {
  const user = db.prepare(`SELECT id, name FROM users WHERE email = ?`).get(email);
  if (!user) {
    console.log(`❌ User not found: ${email}`);
    continue;
  }

  // Remove any existing lunch events today (avoid duplicates)
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

  console.log(`✅ ${user.name}: lunch break added 2:00 PM – 2:20 PM IST`);
}

db.close();
console.log('\nDone.');
