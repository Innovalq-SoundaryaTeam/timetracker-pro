import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));

// Dates July 1-14, 2026 — skip Sat (6) and Sun (0)
const dates = [];
for (let d = 1; d <= 14; d++) {
  const iso = `2026-07-${String(d).padStart(2, '0')}`;
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (day !== 0 && day !== 6) dates.push(iso);
}
console.log('Dates to process:', dates.join(', '));

const users = db.prepare(`SELECT id, name, email FROM users`).all();
console.log(`Users found: ${users.length}\n`);

let totalRemoved = 0;
let totalLogoutsAdded = 0;

for (const user of users) {
  for (const date of dates) {
    const logs = db.prepare(
      `SELECT id, type, timestamp FROM time_logs
       WHERE userId = ? AND date(timestamp) = ?
       ORDER BY timestamp ASC`
    ).all(user.id, date);

    if (logs.length === 0) continue;

    const firstLogin = logs.find(l => l.type === 'login');
    if (!firstLogin) continue;

    const firstLogout = logs.find(l => l.type === 'logout');

    // Ghost logins = every login except the first
    const ghostLogins = logs.filter(l => l.type === 'login' && l.id !== firstLogin.id);

    // Events after first logout = ghost reconnection events
    const afterLogout = firstLogout
      ? logs.filter(l => l.timestamp > firstLogout.timestamp)
      : [];

    const toDelete = [
      ...ghostLogins,
      ...afterLogout.filter(l => !ghostLogins.find(g => g.id === l.id)),
    ];

    if (toDelete.length > 0) {
      for (const log of toDelete) {
        db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(log.id);
      }
      console.log(`${date} | ${user.name}: removed ${toDelete.length} ghost records`);
      totalRemoved += toDelete.length;
    }

    // Add 6:40 PM IST logout (13:10 UTC) if missing
    if (!firstLogout) {
      db.prepare(
        `INSERT INTO time_logs (id, userId, type, timestamp, note, lat, lng)
         VALUES (?, ?, 'logout', ?, 'Auto-added by admin', NULL, NULL)`
      ).run(randomUUID(), user.id, `${date}T13:10:00.000Z`);
      console.log(`${date} | ${user.name}: added missing logout at 6:40 PM IST`);
      totalLogoutsAdded++;
    }
  }
}

db.close();
console.log(`\nDone. Ghost records removed: ${totalRemoved} | Logouts added: ${totalLogoutsAdded}`);
