/**
 * fix-june12-schedule.mjs
 * Sets today's (June 12, 2026) punch-in, morning break, and lunch break
 * for every user:
 *
 *  Everyone (default):
 *    - Punch-in:      9:30 AM IST  (04:00 UTC)
 *    - Morning break: 11:00–11:15 AM IST (05:30–05:45 UTC)
 *    - Lunch break:   1:30–2:00 PM IST   (08:00–08:30 UTC)
 *
 *  Sujasree Sridharan (sujasreesridharan.iq@outlook.com):
 *    - Punch-in:      10:00 AM IST (04:30 UTC)
 *    - Lunch break:   3:00–3:20 PM IST   (09:30–09:50 UTC)
 *
 *  Soundarya Ramnarayanan (soundaryaram2016@gmail.com):
 *    - Lunch break:   1:00–1:30 PM IST   (07:30–08:00 UTC)
 *
 * Run with: node fix-june12-schedule.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

const todayStr = new Date().toISOString().slice(0, 10);

const DEFAULT_LOGIN_TS = `${todayStr}T04:00:00.000Z`; // 9:30 AM IST
const MORNING_START_TS = `${todayStr}T05:30:00.000Z`; // 11:00 AM IST
const MORNING_END_TS   = `${todayStr}T05:45:00.000Z`; // 11:15 AM IST
const DEFAULT_LUNCH_IN  = `${todayStr}T08:00:00.000Z`; // 1:30 PM IST
const DEFAULT_LUNCH_OUT = `${todayStr}T08:30:00.000Z`; // 2:00 PM IST

const SUJA_EMAIL = 'sujasreesridharan.iq@outlook.com';
const SUJA_LOGIN_TS    = `${todayStr}T04:30:00.000Z`; // 10:00 AM IST
const SUJA_LUNCH_IN    = `${todayStr}T09:30:00.000Z`; // 3:00 PM IST
const SUJA_LUNCH_OUT   = `${todayStr}T09:50:00.000Z`; // 3:20 PM IST

const SOUNDARYA_EMAIL = 'soundaryaram2016@gmail.com';
const SOUNDARYA_LUNCH_IN  = `${todayStr}T07:30:00.000Z`; // 1:00 PM IST
const SOUNDARYA_LUNCH_OUT = `${todayStr}T08:00:00.000Z`; // 1:30 PM IST

const insertLog = (userId, type, ts, note) => {
  db.prepare(`
    INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng)
    VALUES (?, ?, ?, ?, ?, NULL, NULL)
  `).run(randomUUID(), userId, type, ts, note);
};

const users = db.prepare(`SELECT id, name, email FROM users`).all();

for (const user of users) {
  // ── Punch-in ─────────────────────────────────────────────
  const loginTs = user.email === SUJA_EMAIL ? SUJA_LOGIN_TS : DEFAULT_LOGIN_TS;

  const loginRow = db.prepare(`
    SELECT id, timestamp FROM time_logs
    WHERE userId = ? AND type = 'login' AND date(timestamp) = ?
    ORDER BY timestamp ASC LIMIT 1
  `).get(user.id, todayStr);

  if (loginRow) {
    db.prepare(`UPDATE time_logs SET timestamp = ? WHERE id = ?`).run(loginTs, loginRow.id);
  } else {
    insertLog(user.id, 'login', loginTs, 'Corrected punch-in time');
  }
  console.log(`✅ ${user.name}: punch-in → ${loginTs}`);

  // ── Morning break (break_start/break_end) ───────────────
  db.prepare(`
    DELETE FROM time_logs WHERE userId = ? AND type IN ('break_start','break_end') AND date(timestamp) = ?
  `).run(user.id, todayStr);

  insertLog(user.id, 'break_start', MORNING_START_TS, 'Morning break (corrected)');
  insertLog(user.id, 'break_end',   MORNING_END_TS,   'Back from morning break (corrected)');
  console.log(`   ↳ morning break → 11:00–11:15 AM IST`);

  // ── Lunch break (lunch_in/lunch_out) ─────────────────────
  let lunchIn = DEFAULT_LUNCH_IN, lunchOut = DEFAULT_LUNCH_OUT, lunchLabel = '1:30–2:00 PM IST';
  if (user.email === SUJA_EMAIL) {
    lunchIn = SUJA_LUNCH_IN; lunchOut = SUJA_LUNCH_OUT; lunchLabel = '3:00–3:20 PM IST';
  } else if (user.email === SOUNDARYA_EMAIL) {
    lunchIn = SOUNDARYA_LUNCH_IN; lunchOut = SOUNDARYA_LUNCH_OUT; lunchLabel = '1:00–1:30 PM IST';
  }

  db.prepare(`
    DELETE FROM time_logs WHERE userId = ? AND type IN ('lunch_in','lunch_out') AND date(timestamp) = ?
  `).run(user.id, todayStr);

  insertLog(user.id, 'lunch_in',  lunchIn,  'Lunch break (corrected)');
  insertLog(user.id, 'lunch_out', lunchOut, 'Back from lunch (corrected)');
  console.log(`   ↳ lunch break   → ${lunchLabel}`);
}

db.close();
console.log('\nDone.');
