/**
 * db.ts — SQLite database layer using Node 24's built-in node:sqlite
 * No native compilation required — works on any platform out of the box.
 */
import { DatabaseSync, StatementSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In production (Fly.io), DATA_DIR env var points to the persistent volume (/data).
// Locally it falls back to a 'data/' folder next to the script.
const DATA_DIR  = process.env.DATA_DIR ?? path.join(__dirname, 'data');
const DB_PATH   = path.join(DATA_DIR, 'timetracker.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Open database ────────────────────────────────────────────────────────────
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA synchronous = NORMAL');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT UNIQUE NOT NULL,
    password     TEXT NOT NULL,
    phone        TEXT,
    role         TEXT NOT NULL DEFAULT 'user',
    department   TEXT,
    employeeId   TEXT,
    shiftTiming  TEXT,
    joiningDate  TEXT,
    profileImage TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    isDeleted    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS time_logs (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    type      TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    note      TEXT,
    lat       REAL,
    lng       REAL,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    description    TEXT,
    assignedTo     TEXT NOT NULL,
    assignedBy     TEXT NOT NULL,
    assignedByName TEXT,
    priority       TEXT NOT NULL DEFAULT 'medium',
    dueDate        TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    createdAt      TEXT NOT NULL,
    updatedAt      TEXT,
    FOREIGN KEY (assignedTo) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assignedBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT NOT NULL DEFAULT '#6366f1',
    createdBy   TEXT NOT NULL,
    createdAt   TEXT NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_members (
    groupId TEXT NOT NULL,
    userId  TEXT NOT NULL,
    PRIMARY KEY (groupId, userId),
    FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (userId)  REFERENCES users(id)  ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_logs_userId    ON time_logs(userId);

  CREATE TABLE IF NOT EXISTS notifications (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    type      TEXT NOT NULL,
    title     TEXT NOT NULL,
    message   TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    isRead    INTEGER NOT NULL DEFAULT 0,
    metadata  TEXT,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_notif_userId ON notifications(userId);
  CREATE INDEX IF NOT EXISTS idx_notif_ts     ON notifications(timestamp);
`);

// Add groupId / groupName columns if they don't exist yet (safe migration)
try { db.exec("ALTER TABLE tasks ADD COLUMN groupId      TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN groupName    TEXT"); } catch (_) {}
// Add submission columns for employee answers
try { db.exec("ALTER TABLE tasks ADD COLUMN submission   TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN submittedAt  TEXT"); } catch (_) {}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON time_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assignedTo);
  CREATE INDEX IF NOT EXISTS idx_tasks_by       ON tasks(assignedBy);
  CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_gm_groupId     ON group_members(groupId);
  CREATE INDEX IF NOT EXISTS idx_gm_userId      ON group_members(userId);
`);

// ─── Seed default admin ───────────────────────────────────────────────────────
const adminRow = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get() as any;
const adminCount = Number(adminRow?.c ?? 0);
if (adminCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    "INSERT INTO users (id,name,email,password,role,status) VALUES (?,?,?,?,'admin','active')"
  ).run(randomUUID(), 'Administrator', 'admin@company.com', hash);
  console.log('✅  Default admin created  →  admin@company.com / admin123');
}

// ─── Typed interfaces ─────────────────────────────────────────────────────────

export interface DBUser {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string | null;
  role: 'user' | 'admin' | 'teamlead';
  department: string | null;
  employeeId: string | null;
  shiftTiming: string | null;
  joiningDate: string | null;
  profileImage: string | null;
  status: 'active' | 'inactive';
  isDeleted: number;
}

export interface DBLog {
  id: string;
  userId: string;
  type: string;
  timestamp: string;
  note: string | null;
  lat: number | null;
  lng: number | null;
}

export interface DBTask {
  id: string;
  title: string;
  description: string | null;
  assignedTo: string;
  assignedBy: string;
  assignedByName: string | null;
  priority: string;
  dueDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  groupId: string | null;
  groupName: string | null;
  submission: string | null;
  submittedAt: string | null;
}

// ─── Helper: typed get / all wrappers ────────────────────────────────────────
// node:sqlite StatementSync does not accept TypeScript generics on prepare(),
// so we wrap with explicit casts here.

function getOne<T>(stmt: StatementSync, ...args: unknown[]): T | undefined {
  return stmt.get(...args) as T | undefined;
}
function getAll<T>(stmt: StatementSync, ...args: unknown[]): T[] {
  return stmt.all(...args) as T[];
}

// ─── User queries ─────────────────────────────────────────────────────────────

const _uFindByEmail  = db.prepare('SELECT * FROM users WHERE email=? AND isDeleted=0');
const _uFindById     = db.prepare('SELECT * FROM users WHERE id=? AND isDeleted=0');
const _uFindAll      = db.prepare('SELECT * FROM users WHERE isDeleted=0 ORDER BY name');
const _uFindByRole   = db.prepare('SELECT * FROM users WHERE role=? AND isDeleted=0 ORDER BY name');
const _uInsert       = db.prepare(
  `INSERT INTO users
     (id,name,email,password,phone,role,department,employeeId,shiftTiming,joiningDate,profileImage,status)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
);
const _uUpdate       = db.prepare(
  `UPDATE users
   SET name=?,phone=?,role=?,department=?,employeeId=?,shiftTiming=?,joiningDate=?,status=?
   WHERE id=? AND isDeleted=0`
);
const _uSoftDelete   = db.prepare('UPDATE users SET isDeleted=1 WHERE id=?');
const _uUpdatePwd    = db.prepare('UPDATE users SET password=? WHERE id=?');

export const userQueries = {
  findByEmail:    (email: string)           => getOne<DBUser>(_uFindByEmail, email),
  findById:       (id: string)              => getOne<DBUser>(_uFindById, id),
  findAll:        ()                        => getAll<DBUser>(_uFindAll),
  findByRole:     (role: string)            => getAll<DBUser>(_uFindByRole, role),
  insert:         (...args: unknown[])      => _uInsert.run(...args),
  update:         (...args: unknown[])      => _uUpdate.run(...args),
  softDelete:     (id: string)              => _uSoftDelete.run(id),
  updatePassword: (hash: string, id: string)=> _uUpdatePwd.run(hash, id),
};

// ─── Log queries ──────────────────────────────────────────────────────────────

const _lInsert     = db.prepare(
  'INSERT INTO time_logs (id,userId,type,timestamp,note,lat,lng) VALUES (?,?,?,?,?,?,?)'
);
const _lForUser    = db.prepare('SELECT * FROM time_logs WHERE userId=? ORDER BY timestamp DESC');
const _lAll        = db.prepare('SELECT * FROM time_logs ORDER BY timestamp DESC');
// Returns only logs from the last 90 days — keeps API payload small for the admin calendar
const _lRecent     = db.prepare("SELECT * FROM time_logs WHERE timestamp >= datetime('now', '-90 days') ORDER BY timestamp DESC");
const _lAllOnDate  = db.prepare("SELECT * FROM time_logs WHERE date(timestamp)=? ORDER BY timestamp ASC");

export const logQueries = {
  insert:    (...args: unknown[]) => _lInsert.run(...args),
  forUser:   (userId: string)     => getAll<DBLog>(_lForUser, userId),
  all:       ()                   => getAll<DBLog>(_lAll),
  recent:    ()                   => getAll<DBLog>(_lRecent),
  allOnDate: (date: string)       => getAll<DBLog>(_lAllOnDate, date),
};

// ─── Task queries ─────────────────────────────────────────────────────────────

const _tAll          = db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC');
const _tForAssignee  = db.prepare('SELECT * FROM tasks WHERE assignedTo=? ORDER BY createdAt DESC');
const _tByAssigner   = db.prepare('SELECT * FROM tasks WHERE assignedBy=? ORDER BY createdAt DESC');
const _tFindById     = db.prepare('SELECT * FROM tasks WHERE id=?');
const _tInsert       = db.prepare(
  `INSERT INTO tasks
     (id,title,description,assignedTo,assignedBy,assignedByName,priority,dueDate,status,createdAt,groupId,groupName)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
);
const _tUpdateStatus = db.prepare('UPDATE tasks SET status=?,updatedAt=? WHERE id=?');
const _tUpdateFull   = db.prepare(
  `UPDATE tasks
   SET title=?,description=?,assignedTo=?,priority=?,dueDate=?,status=?,updatedAt=?
   WHERE id=?`
);
const _tDelete       = db.prepare('DELETE FROM tasks WHERE id=?');
const _tSubmit       = db.prepare('UPDATE tasks SET submission=?,submittedAt=?,status=?,updatedAt=? WHERE id=?');

export const taskQueries = {
  all:          ()               => getAll<DBTask>(_tAll),
  forAssignee:  (id: string)     => getAll<DBTask>(_tForAssignee, id),
  byAssigner:   (id: string)     => getAll<DBTask>(_tByAssigner, id),
  findById:     (id: string)     => getOne<DBTask>(_tFindById, id),
  insert:       (...a: unknown[])=> _tInsert.run(...a),
  updateStatus: (...a: unknown[])=> _tUpdateStatus.run(...a),
  updateFull:   (...a: unknown[])=> _tUpdateFull.run(...a),
  delete:       (id: string)     => _tDelete.run(id),
  submit:       (submission: string, submittedAt: string, status: string, updatedAt: string, id: string) =>
                  _tSubmit.run(submission, submittedAt, status, updatedAt, id),
};

// ─── Group queries ────────────────────────────────────────────────────────────

export interface DBGroup {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdBy: string;
  createdAt: string;
}

const _gAll         = db.prepare('SELECT * FROM groups ORDER BY createdAt DESC');
const _gFindById    = db.prepare('SELECT * FROM groups WHERE id=?');
const _gByCreator   = db.prepare('SELECT * FROM groups WHERE createdBy=? ORDER BY createdAt DESC');
const _gInsert      = db.prepare('INSERT INTO groups (id,name,description,color,createdBy,createdAt) VALUES (?,?,?,?,?,?)');
const _gUpdate      = db.prepare('UPDATE groups SET name=?,description=?,color=? WHERE id=?');
const _gDelete      = db.prepare('DELETE FROM groups WHERE id=?');

// group_members
const _gmMembersOf  = db.prepare('SELECT userId FROM group_members WHERE groupId=?');
const _gmGroupsOf   = db.prepare('SELECT groupId FROM group_members WHERE userId=?');
const _gmAdd        = db.prepare('INSERT OR IGNORE INTO group_members (groupId,userId) VALUES (?,?)');
const _gmRemove     = db.prepare('DELETE FROM group_members WHERE groupId=? AND userId=?');
const _gmClear      = db.prepare('DELETE FROM group_members WHERE groupId=?');

export const groupQueries = {
  all:       ()                                        => getAll<DBGroup>(_gAll),
  byCreator: (createdBy: string)                       => getAll<DBGroup>(_gByCreator, createdBy),
  findById:  (id: string)                              => getOne<DBGroup>(_gFindById, id),
  insert:    (...a: unknown[])                         => _gInsert.run(...a),
  update:    (name: string, desc: string|null, color: string, id: string) => _gUpdate.run(name, desc, color, id),
  delete:    (id: string)                              => _gDelete.run(id),
};

export const groupMemberQueries = {
  membersOf: (groupId: string) => (getAll<{ userId: string }>(_gmMembersOf, groupId)).map(r => r.userId),
  groupsOf:  (userId: string)  => (getAll<{ groupId: string }>(_gmGroupsOf, userId)).map(r => r.groupId),
  add:       (groupId: string, userId: string) => _gmAdd.run(groupId, userId),
  remove:    (groupId: string, userId: string) => _gmRemove.run(groupId, userId),
  clear:     (groupId: string)                 => _gmClear.run(groupId),
};

// ─── Serialisation helpers ────────────────────────────────────────────────────

export function safeUser(u: DBUser) {
  const { password, isDeleted, ...rest } = u;
  return {
    ...rest,
    isDeleted:    isDeleted === 1,
    phone:        rest.phone        ?? undefined,
    department:   rest.department   ?? undefined,
    employeeId:   rest.employeeId   ?? undefined,
    shiftTiming:  rest.shiftTiming  ?? undefined,
    joiningDate:  rest.joiningDate  ?? undefined,
    profileImage: rest.profileImage ?? undefined,
  };
}

export function formatLog(l: DBLog) {
  return {
    id:        l.id,
    userId:    l.userId,
    type:      l.type,
    timestamp: l.timestamp,
    note:      l.note ?? undefined,
    location:  (l.lat !== null && l.lng !== null) ? { lat: l.lat, lng: l.lng } : null,
  };
}

export function formatTask(t: DBTask) {
  return {
    id:             t.id,
    title:          t.title,
    description:    t.description    ?? '',
    assignedTo:     t.assignedTo,
    assignedBy:     t.assignedBy,
    assignedByName: t.assignedByName ?? undefined,
    priority:       t.priority,
    dueDate:        t.dueDate        ?? null,
    status:         t.status,
    createdAt:      t.createdAt,
    updatedAt:      t.updatedAt      ?? undefined,
    groupId:        t.groupId        ?? null,
    groupName:      t.groupName      ?? null,
    submission:     t.submission     ?? null,
    submittedAt:    t.submittedAt    ?? null,
  };
}

// ─── Notification queries ─────────────────────────────────────────────────────

export interface DBNotification {
  id:        string;
  userId:    string;
  type:      string;
  title:     string;
  message:   string;
  timestamp: string;
  isRead:    number;
  metadata:  string | null;
}

const _nInsert      = db.prepare('INSERT INTO notifications (id,userId,type,title,message,timestamp,isRead,metadata) VALUES (?,?,?,?,?,?,0,?)');
const _nForUser     = db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY timestamp DESC LIMIT 50');
const _nMarkRead    = db.prepare('UPDATE notifications SET isRead=1 WHERE id=?');
const _nMarkAllRead = db.prepare('UPDATE notifications SET isRead=1 WHERE userId=?');
const _nCountSince  = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE userId=? AND type=? AND timestamp>=?');

export const notificationQueries = {
  insert:      (...args: unknown[])                              => _nInsert.run(...args),
  forUser:     (userId: string)                                  => getAll<DBNotification>(_nForUser, userId),
  markRead:    (id: string)                                      => _nMarkRead.run(id),
  markAllRead: (userId: string)                                  => _nMarkAllRead.run(userId),
  existsSince: (userId: string, type: string, since: string)     => {
    const row = _nCountSince.get(userId, type, since) as any;
    return Number(row?.c ?? 0) > 0;
  },
};

export default db;
