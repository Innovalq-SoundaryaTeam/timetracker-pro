/**
 * fix-bulk-schedule.mjs
 * For Soundarya Ramnarayanan & Naveen Kumar:
 *   Date range: June 6 – today, weekdays only (Mon–Fri)
 *   Punch-in:      random 9:25–9:30 AM IST
 *   Morning break: 11:00–11:10 AM IST
 *   Lunch:         1:00–1:30 PM IST
 *   Evening break: 4:00–4:13 PM IST
 *   Logout:        random 6:30–6:40 PM IST
 *
 *   Soundarya: if she has no login on a day, randomly fill 4–5 missing days.
 *   Naveen:    apply to ALL weekdays in range.
 *
 * Run with: node fix-bulk-schedule.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'timetracker.db');
const db = new DatabaseSync(DB_PATH);

// ── Helpers ────────────────────────────────────────────────────────────
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pad = n => String(n).padStart(2, '0');

// UTC offset for IST = +05:30 → subtract 5h30m from IST to get UTC
const toUTC = (dateStr, h, m, s = 0) => {
  // IST time → UTC: subtract 5h30m
  let utcH = h - 5, utcM = m - 30;
  if (utcM < 0) { utcM += 60; utcH -= 1; }
  if (utcH < 0) { utcH += 24; } // shouldn't happen in our range
  return `${dateStr}T${pad(utcH)}:${pad(utcM)}:${pad(s)}.000Z`;
};

// Random punch-in between 9:25 and 9:30 AM IST
const randLogin = (dateStr) => {
  const totalSecs = randInt(0, 5 * 60); // 0–300 seconds after 9:25
  const baseMin = 25;
  const m = baseMin + Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return toUTC(dateStr, 9, m, s);
};

// Random logout between 6:30 and 6:40 PM IST
const randLogout = (dateStr) => {
  const totalSecs = randInt(0, 10 * 60); // 0–600 seconds after 6:30
  const baseMin = 30;
  const m = baseMin + Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return toUTC(dateStr, 18, m, s);
};

const insertLog = (userId, type, ts, note) => {
  db.prepare(`
    INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng)
    VALUES (?, ?, ?, ?, ?, NULL, NULL)
  `).run(randomUUID(), userId, type, ts, note);
};

// Apply full day schedule to a user for a given date
const applyDay = (userId, dateStr) => {
  const loginTs   = randLogin(dateStr);
  const logoutTs  = randLogout(dateStr);
  const mbStartTs = toUTC(dateStr, 11, 0);   // morning break start 11:00
  const mbEndTs   = toUTC(dateStr, 11, 10);  // morning break end   11:10
  const liTs      = toUTC(dateStr, 13, 0);   // lunch in  1:00 PM
  const loTs      = toUTC(dateStr, 13, 30);  // lunch out 1:30 PM
  const ebStartTs = toUTC(dateStr, 16, 0);   // evening break start 4:00 PM
  const ebEndTs   = toUTC(dateStr, 16, 13);  // evening break end   4:13 PM

  // Fix or insert login
  const existing = db.prepare(`
    SELECT id FROM time_logs WHERE userId=? AND type='login' AND date(timestamp)=?
    ORDER BY timestamp ASC LIMIT 1
  `).get(userId, dateStr);
  if (existing) {
    db.prepare(`UPDATE time_logs SET timestamp=? WHERE id=?`).run(loginTs, existing.id);
  } else {
    insertLog(userId, 'login', loginTs, 'Attendance (corrected)');
  }

  // Fix or insert logout
  const existingOut = db.prepare(`
    SELECT id FROM time_logs WHERE userId=? AND type='logout' AND date(timestamp)=?
    ORDER BY timestamp ASC LIMIT 1
  `).get(userId, dateStr);
  if (existingOut) {
    db.prepare(`UPDATE time_logs SET timestamp=? WHERE id=?`).run(logoutTs, existingOut.id);
    // Delete any extra logouts
    db.prepare(`
      DELETE FROM time_logs WHERE userId=? AND type='logout' AND date(timestamp)=? AND id!=?
    `).run(userId, dateStr, existingOut.id);
  } else {
    insertLog(userId, 'logout', logoutTs, 'Auto punch-out (corrected)');
  }

  // Delete any ghost events after logout
  db.prepare(`
    DELETE FROM time_logs WHERE userId=? AND date(timestamp)=?
    AND type NOT IN ('login','logout') AND timestamp > ?
  `).run(userId, dateStr, logoutTs);

  // Wipe and re-insert break and lunch events
  db.prepare(`DELETE FROM time_logs WHERE userId=? AND type IN ('break_start','break_end') AND date(timestamp)=?`).run(userId, dateStr);
  db.prepare(`DELETE FROM time_logs WHERE userId=? AND type IN ('lunch_in','lunch_out') AND date(timestamp)=?`).run(userId, dateStr);

  insertLog(userId, 'break_start', mbStartTs, 'Morning break');
  insertLog(userId, 'break_end',   mbEndTs,   'Back from morning break');
  insertLog(userId, 'lunch_in',    liTs,      'Lunch break');
  insertLog(userId, 'lunch_out',   loTs,      'Back from lunch');
  insertLog(userId, 'break_start', ebStartTs, 'Evening break');
  insertLog(userId, 'break_end',   ebEndTs,   'Back from evening break');
};

// ── Build list of weekdays June 6 → today ─────────────────────────────
const weekdays = [];
const start = new Date('2026-06-06T00:00:00Z');
const end   = new Date();
for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const dow = d.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) continue;
  weekdays.push(d.toISOString().slice(0, 10));
}
console.log(`Weekdays in range (${weekdays.length}): ${weekdays.join(', ')}\n`);

// ── Naveen Kumar ───────────────────────────────────────────────────────
const naveen = db.prepare(`SELECT id, name FROM users WHERE email=?`).get('digitalmarketing.iq@outlook.com');
if (!naveen) {
  console.log('❌ Naveen Kumar not found');
} else {
  for (const day of weekdays) {
    applyDay(naveen.id, day);
    console.log(`✅ ${naveen.name}: ${day} schedule set`);
  }
}

// ── Soundarya Ramnarayanan ─────────────────────────────────────────────
const soundarya = db.prepare(`SELECT id, name FROM users WHERE email=?`).get('soundaryaram2016@gmail.com');
if (!soundarya) {
  console.log('❌ Soundarya not found');
} else {
  // Find days she already has a login
  const existingDays = new Set(
    db.prepare(`
      SELECT DISTINCT date(timestamp) as d FROM time_logs
      WHERE userId=? AND type='login' AND date(timestamp) BETWEEN '2026-06-06' AND date('now')
    `).all(soundarya.id).map(r => r.d)
  );

  // Missing days = weekdays with no login
  const missingDays = weekdays.filter(d => !existingDays.has(d));

  // Randomly pick 4–5 missing days to fill (if enough missing)
  const fillCount = Math.min(randInt(4, 5), missingDays.length);
  const shuffled  = missingDays.sort(() => Math.random() - 0.5);
  const fillDays  = new Set(shuffled.slice(0, fillCount));

  // Days to process = existing days + randomly chosen missing days
  const soundaryaDays = weekdays.filter(d => existingDays.has(d) || fillDays.has(d));

  console.log('');
  console.log(`Soundarya — existing logins on: ${[...existingDays].join(', ') || 'none'}`);
  console.log(`Soundarya — filling missing days: ${[...fillDays].join(', ')}`);

  for (const day of soundaryaDays) {
    applyDay(soundarya.id, day);
    console.log(`✅ ${soundarya.name}: ${day} schedule set`);
  }
}

db.close();
console.log('\nDone.');
