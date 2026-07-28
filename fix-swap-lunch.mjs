/**
 * fix-swap-lunch.mjs
 *
 * ROOT CAUSE FIX: Previous scripts inserted lunch_out BEFORE lunch_in
 * (wrong order). The app calculates work time as:
 *   - lunch_in  → employee GOES for lunch  (stops timer)
 *   - lunch_out → employee RETURNS from lunch (starts timer)
 *
 * This script finds every record where lunch_out timestamp < lunch_in
 * for the same user on the same date, and swaps their types.
 * Only the TYPE label changes — timestamps stay the same.
 *
 * Run: node fix-swap-lunch.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));

// Find all user/date pairs where lunch_out comes BEFORE lunch_in (wrong order)
const wrongPairs = db.prepare(`
  SELECT
    lo.id   AS lo_id,
    li.id   AS li_id,
    u.name  AS name,
    date(lo.timestamp) AS d,
    lo.timestamp AS lo_ts,
    li.timestamp AS li_ts
  FROM time_logs lo
  JOIN time_logs li
    ON  lo.userId          = li.userId
    AND date(lo.timestamp) = date(li.timestamp)
  JOIN users u ON u.id = lo.userId
  WHERE lo.type = 'lunch_out'
    AND li.type = 'lunch_in'
    AND lo.timestamp < li.timestamp
  ORDER BY u.name, lo.timestamp
`).all();

console.log(`Found ${wrongPairs.length} pair(s) with inverted lunch events.\n`);

let fixed = 0;
for (const pair of wrongPairs) {
  db.prepare(`UPDATE time_logs SET type = 'lunch_in'  WHERE id = ?`).run(pair.lo_id);
  db.prepare(`UPDATE time_logs SET type = 'lunch_out' WHERE id = ?`).run(pair.li_id);
  console.log(`${pair.d} | ${pair.name}: swapped lunch_out↔lunch_in (${pair.lo_ts.slice(11,16)} ↔ ${pair.li_ts.slice(11,16)} UTC)`);
  fixed++;
}

db.close();
console.log(`\nDone. Fixed ${fixed} record pair(s).`);
console.log('All affected days should now show correct ~8h productive time.');
