import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));

// login 9:25, break 11-11:15, lunch 1-1:30, break 4-4:15, logout 6:30 (IST → UTC)
const EVENTS = [
  { type: 'login',       time: '03:55:00' }, // 9:25 AM IST
  { type: 'break_start', time: '05:30:00' }, // 11:00 AM IST
  { type: 'break_end',   time: '05:45:00' }, // 11:15 AM IST
  { type: 'lunch_out',   time: '07:30:00' }, // 1:00 PM IST
  { type: 'lunch_in',    time: '08:00:00' }, // 1:30 PM IST
  { type: 'break_start', time: '10:30:00' }, // 4:00 PM IST
  { type: 'break_end',   time: '10:45:00' }, // 4:15 PM IST
  { type: 'logout',      time: '13:00:00' }, // 6:30 PM IST
];

const FIXES = [
  { email: 'tamil.iq@outlook.com',           dates: ['2026-07-02','2026-07-03'] },
  { email: 'bragathishwaran.iq@outlook.com', dates: ['2026-07-01','2026-06-02'] },
  { email: 'logaprasath.iq@outlook.com',     dates: ['2026-06-30','2026-07-02','2026-07-06'] },
  { email: 'chandruiq@thestackly.com',       dates: ['2026-07-02','2026-07-06','2026-07-07'] },
  { email: 'rahul.k.iq@outlook.com',         dates: ['2026-07-13'] },
  { email: 'kowsalya.iq@outlook.com',        dates: ['2026-07-06'] },
  { name:  'koperumnayagi',                  dates: ['2026-07-07'] },
  { name:  'vamsikrishnan',                  dates: ['2026-07-13'] },
  { name:  'sarath',                         dates: ['2026-07-06'] },
  { name:  'arunsunai',                      dates: ['2026-07-06'] },
  { name:  'gowtham',                        dates: ['2026-07-06'] },
  { name:  'vignesh',                        dates: ['2026-07-06'] },
  { name:  'tamilselvan',                    dates: ['2026-07-06'] },
  { name:  'tharun',                         dates: ['2026-07-02'] },
  { name:  'karan',                          dates: ['2026-07-09'] },
];

for (const fix of FIXES) {
  let user;
  if (fix.email) {
    user = db.prepare(`SELECT id, name FROM users WHERE LOWER(email) = ?`).get(fix.email.toLowerCase());
    if (!user) { console.log(`NOT FOUND (email): ${fix.email}`); continue; }
  } else {
    user = db.prepare(`SELECT id, name FROM users WHERE LOWER(name) LIKE ?`).get(`%${fix.name.toLowerCase()}%`);
    if (!user) { console.log(`NOT FOUND (name): ${fix.name}`); continue; }
  }

  for (const date of fix.dates) {
    const del = db.prepare(`DELETE FROM time_logs WHERE userId = ? AND date(timestamp) = ?`).run(user.id, date);
    console.log(`${date} | ${user.name}: cleared ${del.changes} records`);
    for (const ev of EVENTS) {
      db.prepare(`INSERT INTO time_logs (id,userId,type,timestamp,note,lat,lng) VALUES (?,?,?,?,?,NULL,NULL)`)
        .run(randomUUID(), user.id, ev.type, `${date}T${ev.time}.000Z`, 'Fixed by admin');
    }
    console.log(`${date} | ${user.name}: inserted 8 events`);
  }
}

db.close();
console.log('\nDone.');
