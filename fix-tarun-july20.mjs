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
  { type: 'lunch_in',    time: '07:30:00' }, // 1:00 PM IST — goes for lunch
  { type: 'lunch_out',   time: '08:00:00' }, // 1:30 PM IST — returns from lunch
  { type: 'break_start', time: '10:30:00' }, // 4:00 PM IST
  { type: 'break_end',   time: '10:45:00' }, // 4:15 PM IST
  { type: 'logout',      time: '13:00:00' }, // 6:30 PM IST
];

const date = '2026-07-20';
const user = db.prepare(`SELECT id, name FROM users WHERE email = ?`).get('tarun.iq@outlook.com');
if (!user) { console.log('❌ Tarun not found'); process.exit(1); }
console.log(`Found: ${user.name}`);

const del = db.prepare(`DELETE FROM time_logs WHERE userId = ? AND date(timestamp) = ?`).run(user.id, date);
console.log(`Cleared ${del.changes} records for ${date}`);

for (const ev of EVENTS) {
  db.prepare(`INSERT INTO time_logs (id,userId,type,timestamp,note,lat,lng) VALUES (?,?,?,?,?,NULL,NULL)`)
    .run(randomUUID(), user.id, ev.type, `${date}T${ev.time}.000Z`, 'Fixed by admin');
}
console.log(`Inserted 8 events ✓`);

db.close();
console.log('Done. Tarun July 20 → 8h ✓');
