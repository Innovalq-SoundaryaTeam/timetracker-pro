import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));

const DATE = '2026-07-10';

// IST → UTC (subtract 5:30)
// Default: login 9:25, break 11-11:15, lunch 1-1:30, break 4-4:15, logout 6:30
const DEFAULT_EVENTS = [
  { type: 'login',       time: '03:55:00' }, // 9:25 AM IST
  { type: 'break_start', time: '05:30:00' }, // 11:00 AM IST
  { type: 'break_end',   time: '05:45:00' }, // 11:15 AM IST
  { type: 'lunch_out',   time: '07:30:00' }, // 1:00 PM IST
  { type: 'lunch_in',    time: '08:00:00' }, // 1:30 PM IST
  { type: 'break_start', time: '10:30:00' }, // 4:00 PM IST
  { type: 'break_end',   time: '10:45:00' }, // 4:15 PM IST
  { type: 'logout',      time: '13:00:00' }, // 6:30 PM IST
];

// Tamil: login 9:25, break 11-11:15, lunch 1-1:30, logout 4:00 (no evening break)
const TAMIL_EVENTS = [
  { type: 'login',       time: '03:55:00' }, // 9:25 AM IST
  { type: 'break_start', time: '05:30:00' }, // 11:00 AM IST
  { type: 'break_end',   time: '05:45:00' }, // 11:15 AM IST
  { type: 'lunch_out',   time: '07:30:00' }, // 1:00 PM IST
  { type: 'lunch_in',    time: '08:00:00' }, // 1:30 PM IST
  { type: 'logout',      time: '10:30:00' }, // 4:00 PM IST
];

// Sujas: login 10:00, lunch 3:00-3:20, logout 6:00
const SUJAS_EVENTS = [
  { type: 'login',       time: '04:30:00' }, // 10:00 AM IST
  { type: 'lunch_out',   time: '09:30:00' }, // 3:00 PM IST
  { type: 'lunch_in',    time: '09:50:00' }, // 3:20 PM IST
  { type: 'logout',      time: '12:30:00' }, // 6:00 PM IST
];

const users = db.prepare(`SELECT id, name, email FROM users`).all();
console.log(`Total users: ${users.length}\n`);

for (const user of users) {
  const nameL = user.name.toLowerCase();
  const emailL = user.email.toLowerCase();

  // Skip Karthik — mark as leave (no records inserted)
  if (nameL.includes('karthik') || emailL.includes('karthik')) {
    const del = db.prepare(`DELETE FROM time_logs WHERE userId = ? AND date(timestamp) = ?`).run(user.id, DATE);
    console.log(`LEAVE  | ${user.name}: cleared ${del.changes} records (Karthik - leave day)`);
    continue;
  }

  let events;
  if (emailL === 'tamil.iq@outlook.com') {
    events = TAMIL_EVENTS;
  } else if (emailL === 'sujasreesridharan.iq@outlook.com') {
    events = SUJAS_EVENTS;
  } else {
    events = DEFAULT_EVENTS;
  }

  const del = db.prepare(`DELETE FROM time_logs WHERE userId = ? AND date(timestamp) = ?`).run(user.id, DATE);
  console.log(`${DATE} | ${user.name}: cleared ${del.changes} old records`);

  for (const ev of events) {
    db.prepare(
      `INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng) VALUES (?, ?, ?, ?, ?, NULL, NULL)`
    ).run(randomUUID(), user.id, ev.type, `${DATE}T${ev.time}.000Z`, 'Fixed by admin');
  }
  console.log(`${DATE} | ${user.name}: inserted ${events.length} events`);
}

db.close();
console.log('\nDone.');
