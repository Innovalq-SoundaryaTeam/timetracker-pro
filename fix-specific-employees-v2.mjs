import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));

// IST to UTC:
// login 9:30 IST = 04:00 UTC
// morning break 11:00-11:15 IST = 05:30-05:45 UTC
// lunch 14:00-14:30 IST = 08:30-09:00 UTC
// evening break 16:00-16:15 IST = 10:30-10:45 UTC
// logout 18:30 IST = 13:00 UTC
const EVENTS = [
  { type: 'login',       time: '04:00:00' },
  { type: 'break_start', time: '05:30:00' },
  { type: 'break_end',   time: '05:45:00' },
  { type: 'lunch_out',   time: '08:30:00' },
  { type: 'lunch_in',    time: '09:00:00' },
  { type: 'break_start', time: '10:30:00' },
  { type: 'break_end',   time: '10:45:00' },
  { type: 'logout',      time: '13:00:00' },
];

const FIXES = [
  { email: 'chandruiq@thestackly.com',       dates: ['2026-07-02','2026-07-06','2026-07-07'] },
  { email: 'tamil.iq@outlook.com',            dates: ['2026-07-02','2026-07-03'] },
  { email: 'kowsalya.iq@outlook.com',         dates: ['2026-07-06'] },
  { email: 'bragathishwaran.iq@outlook.com',  dates: ['2026-06-02','2026-07-01'] },
  { email: 'logaprasath.iq@outlook.com',      dates: ['2026-06-30','2026-07-02','2026-07-06'] },
];

for (const fix of FIXES) {
  const user = db.prepare(`SELECT id, name FROM users WHERE email = ?`).get(fix.email);
  if (!user) { console.log(`Not found: ${fix.email}`); continue; }

  for (const day of fix.dates) {
    const del = db.prepare(`DELETE FROM time_logs WHERE userId = ? AND date(timestamp) = ?`).run(user.id, day);
    console.log(`${day} | ${user.name}: cleared ${del.changes} records`);
    for (const ev of EVENTS) {
      db.prepare(`INSERT INTO time_logs (id,userId,type,timestamp,note,lat,lng) VALUES (?,?,?,?,?,NULL,NULL)`)
        .run(randomUUID(), user.id, ev.type, `${day}T${ev.time}.000Z`, 'Fixed by admin');
    }
    console.log(`${day} | ${user.name}: inserted clean attendance`);
  }
}

db.close();
console.log('\nDone.');
