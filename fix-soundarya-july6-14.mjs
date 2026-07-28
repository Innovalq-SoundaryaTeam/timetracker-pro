import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));

// login 9:25, break 11-11:15, lunch 1-1:30, break 4-4:15, logout 6:30 (IST → UTC)
// lunch_in = goes for lunch (stops timer), lunch_out = returns (resumes timer)
const EVENTS = [
  { type: 'login',       time: '03:55:00' },
  { type: 'break_start', time: '05:30:00' },
  { type: 'break_end',   time: '05:45:00' },
  { type: 'lunch_in',    time: '07:30:00' }, // 1:00 PM IST — goes for lunch
  { type: 'lunch_out',   time: '08:00:00' }, // 1:30 PM IST — returns from lunch
  { type: 'break_start', time: '10:30:00' },
  { type: 'break_end',   time: '10:45:00' },
  { type: 'logout',      time: '13:00:00' },
];

// July 6–14, skip Sat (6) and Sun (0)
const dates = [];
for (let d = 6; d <= 14; d++) {
  const iso = `2026-07-${String(d).padStart(2, '0')}`;
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (day !== 0 && day !== 6) dates.push(iso);
}
console.log('Dates:', dates.join(', '));

// Fix ALL users with "soundarya" in name (covers all Soundarya accounts)
const users = db.prepare(`SELECT id, name, email FROM users WHERE LOWER(name) LIKE '%soundarya%'`).all();
console.log(`Found ${users.length} Soundarya account(s):`);
users.forEach(u => console.log(`  → ${u.name} (${u.email})`));
console.log();

for (const user of users) {
  for (const date of dates) {
    const del = db.prepare(`DELETE FROM time_logs WHERE userId = ? AND date(timestamp) = ?`).run(user.id, date);
    console.log(`${date} | ${user.name}: cleared ${del.changes} records`);
    for (const ev of EVENTS) {
      db.prepare(`INSERT INTO time_logs (id,userId,type,timestamp,note,lat,lng) VALUES (?,?,?,?,?,NULL,NULL)`)
        .run(randomUUID(), user.id, ev.type, `${date}T${ev.time}.000Z`, 'Fixed by admin');
    }
    console.log(`${date} | ${user.name}: inserted 8 events ✓`);
  }
}

db.close();
console.log('\nDone. Soundarya July 6–14 complete.');
