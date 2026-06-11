import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const db = new DatabaseSync('data/timetracker.db');
const skip = ['idle_start','idle_end','location_update','daily_report'];

// Fix all past days with missing logouts
const today = new Date().toISOString().slice(0, 10);
const allDays = db.prepare("SELECT DISTINCT userId, date(timestamp) as day FROM time_logs WHERE type='login' AND date(timestamp)<? ").all(today);

let fixed = 0;
const daysDone = new Set();

for (const { userId, day } of allDays) {
  const logs = db.prepare("SELECT type FROM time_logs WHERE userId=? AND date(timestamp)=? ORDER BY timestamp ASC").all(userId, day).filter(l => !skip.includes(l.type));
  if (!logs.length) continue;
  const last = logs[logs.length - 1];
  if (last.type !== 'logout') {
    const ts = `${day}T13:10:00.000Z`;
    db.prepare("INSERT INTO time_logs(id,userId,type,timestamp,note,lat,lng) VALUES(?,?,'logout',?,'Auto punch-out backfill',NULL,NULL)").run(randomUUID(), userId, ts);
    console.log(`Fixed: ${userId}  date: ${day}`);
    fixed++;
  }
}

console.log(`\nDone — ${fixed} missing logout(s) fixed.`);
db.close();
