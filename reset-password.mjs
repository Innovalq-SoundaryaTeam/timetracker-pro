/**
 * reset-password.mjs — resets admin@company.com to admin123
 * Run: node reset-password.mjs
 */
import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data', 'timetracker.db'));

const email   = 'admin@company.com';
const newPass = 'admin123';
const hash    = bcrypt.hashSync(newPass, 10);

const result = db.prepare('UPDATE users SET password=? WHERE email=?').run(hash, email);

if (Number(result.changes) > 0) {
  console.log('✅  Password reset successfully');
} else {
  // No admin row yet — create one
  db.prepare("INSERT INTO users (id,name,email,password,role,status) VALUES (?,?,?,?,'admin','active')")
    .run(randomUUID(), 'Administrator', email, hash);
  console.log('✅  Admin account created');
}

console.log(`    Email   : ${email}`);
console.log(`    Password: ${newPass}`);
db.close();
