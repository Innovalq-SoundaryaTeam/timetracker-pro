import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));
const EVENTS = [
  { type: 'login',       time: '03:55:00' },
  { type: 'break_start', time: '05:30:00' },
  { type: 'break_end',   time: '05:45:00' },
  { type: 'lunch_out',   time: '07:30:00' },
  { type: 'lunch_in',    time: '08:00:00' },
  { type: 'break_start', time: '10:30:00' },
  { type: 'break_end',   time: '10:45:00' },
  { type: 'logout',      time: '13:00:00' },
];
const FIXES = [
  { email: 'arunsunaigowtham.iq@outlook.com', dates: ['2026-07-06'] },
  { email: 'tamilselvan.iq@outlook.com',      dates: ['2026-07-06'] },
  { email: 'tarun.iq@outlook.com',            dates: ['2026-07-02'] },
  { email: 'koperumnayaki.iq@outlook.com',    dates: ['2026-07-07'] },
  { email: 'vamsikrishna.iq@outlook.com',     dates: ['2026-07-13'] },
];
for (const fix of FIXES) {
  const user = db.prepare(`SELECT id, name FROM users WHERE LOWER(email) = ?`).get(fix.email.toLowerCase());
  if (!user) { console.log(`NOT FOUND: ${fix.email}`); continue; }
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
