/**
 * server.ts — TimeTracker Pro  (Express + SQLite via node:sqlite)
 */
import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  userQueries,
  logQueries,
  taskQueries,
  groupQueries,
  groupMemberQueries,
  notificationQueries,
  safeUser,
  formatLog,
  formatTask,
  DBUser,
} from './db.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PORT       = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET   || 'timetracker-secret-key-2024';
const DATA_DIR   = process.env.DATA_DIR ?? path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '5mb' }));

// ─── Auth middleware ──────────────────────────────────────────────────────────

interface AuthRequest extends Request { user?: DBUser; }

function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'No token' }); return; }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
    const user    = userQueries.findById(payload.userId);
    if (!user) { res.status(401).json({ error: 'User not found' }); return; }
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  next();
}

function requireTeamLead(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin' && req.user?.role !== 'teamlead') {
    res.status(403).json({ error: 'Team lead or admin required' }); return;
  }
  next();
}

// ─── Auth routes ─────────────────────────────────────────────────────────────

app.post('/api/auth/register', (req: Request, res: Response): void => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) { res.status(400).json({ error: 'Name, email and password required' }); return; }
  if (userQueries.findByEmail(email)) { res.status(409).json({ error: 'Email already registered' }); return; }

  const id   = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  userQueries.insert(id, name, email, hash, phone ?? null, 'user', null, null, null, null, null, 'active');

  const user  = userQueries.findById(id)!;
  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: safeUser(user) });
});

app.post('/api/auth/login', (req: Request, res: Response): void => {
  const { email, password } = req.body;
  if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }

  const user = userQueries.findByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    res.status(401).json({ error: 'Invalid credentials' }); return;
  }
  if (user.status === 'inactive') { res.status(403).json({ error: 'Account inactive. Contact admin.' }); return; }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: safeUser(user) });
});

// ─── Log routes ───────────────────────────────────────────────────────────────

app.get('/api/logs', requireAuth, (req: AuthRequest, res: Response): void => {
  res.json(logQueries.forUser(req.user!.id).map(formatLog));
});

app.post('/api/logs', requireAuth, (req: AuthRequest, res: Response): void => {
  const { type, note, location } = req.body;
  const valid = ['login','logout','lunch_in','lunch_out','break_start','break_end','daily_report','idle_start','idle_end','location_update'];
  if (!valid.includes(type)) { res.status(400).json({ error: `Invalid log type: ${type}` }); return; }

  const userId = req.user!.id;
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Duplicate prevention ──────────────────────────────────────────────────
  // Get today's logs for this user, sorted ascending
  const allUserLogs = logQueries.forUser(userId)
    .filter(l => l.timestamp.startsWith(todayStr))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Last meaningful log (ignoring idle and location updates)
  const lastMeaningful = [...allUserLogs]
    .reverse()
    .find(l => !['idle_start','idle_end','location_update','daily_report'].includes(l.type));

  const lastType = lastMeaningful?.type ?? null;

  // Prevent duplicate consecutive events
  if (type === 'login'       && lastType === 'login')       { res.status(409).json({ error: 'Already punched in' }); return; }
  if (type === 'login'       && lastType === 'logout')      { res.status(409).json({ error: 'Already punched out for today' }); return; }
  if (type === 'logout'      && lastType === 'logout')      { res.status(409).json({ error: 'Already punched out' }); return; }
  if (type === 'logout'      && !lastType)                  { res.status(409).json({ error: 'Not punched in yet' }); return; }
  if (type === 'break_start' && lastType === 'break_start') { res.status(409).json({ error: 'Already on break — finish current break first' }); return; }
  if (type === 'break_end'   && lastType !== 'break_start') { res.status(409).json({ error: 'No active break to finish' }); return; }
  if (type === 'lunch_in'    && lastType === 'lunch_in')    { res.status(409).json({ error: 'Already on lunch break' }); return; }
  if (type === 'lunch_out'   && lastType !== 'lunch_in')    { res.status(409).json({ error: 'No active lunch break to finish' }); return; }

  // Prevent break_start if not currently working
  if (type === 'break_start') {
    const validBeforeBreak = ['login', 'break_end', 'lunch_out'];
    if (!lastType || !validBeforeBreak.includes(lastType)) {
      res.status(409).json({ error: 'Must be punched in to start a break' }); return;
    }
  }

  const id = randomUUID();
  const ts = new Date().toISOString();
  logQueries.insert(id, userId, type, ts, note ?? null, location?.lat ?? null, location?.lng ?? null);
  res.json(formatLog({ id, userId, type, timestamp: ts, note: note ?? null, lat: location?.lat ?? null, lng: location?.lng ?? null }));
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

app.get('/api/admin/data', requireAuth, requireAdmin, (_req: Request, res: Response): void => {
  res.json({ users: userQueries.findAll().map(safeUser), logs: logQueries.all().map(formatLog) });
});

app.get('/api/teamlead/data', requireAuth, requireTeamLead, (_req: Request, res: Response): void => {
  res.json({ users: userQueries.findByRole('user').map(safeUser), logs: logQueries.all().map(formatLog) });
});

// GET /api/admin/attendance/:date — per-day attendance for every employee
app.get('/api/admin/attendance/:date', requireAuth, requireAdmin, (req: Request, res: Response): void => {
  const { date } = req.params; // yyyy-MM-dd
  const allUsers = userQueries.findByRole('user');
  const allLogs  = logQueries.allOnDate(date);

  const result = allUsers.map(u => {
    const uLogs = allLogs.filter(l => l.userId === u.id);
    const sorted = [...uLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const punchIn  = sorted.find(l => l.type === 'login');
    const punchOut = [...sorted].reverse().find(l => l.type === 'logout');
    const lastLog  = [...sorted].reverse().find(l => l.type !== 'daily_report');

    let status = 'absent';
    if (uLogs.length > 0) {
      if (punchOut)                                      status = 'left';
      else if (lastLog?.type === 'lunch_in' || lastLog?.type === 'break_start') status = 'on_break';
      else if (lastLog?.type === 'login' || lastLog?.type === 'lunch_out' || lastLog?.type === 'break_end') status = 'present';
      else                                               status = 'present';
    }

    return {
      user:         safeUser(u),
      logs:         uLogs.map(formatLog),
      status,
      punchInTime:  punchIn?.timestamp  ?? null,
      punchOutTime: punchOut?.timestamp ?? null,
    };
  });

  res.json(result);
});

// ─── User management ─────────────────────────────────────────────────────────

app.get('/api/users', requireAuth, requireAdmin, (_req: Request, res: Response): void => {
  res.json(userQueries.findAll().map(safeUser));
});

app.post('/api/users', requireAuth, requireTeamLead, (req: Request, res: Response): void => {
  const { name, email, password, phone, role = 'user', department, employeeId, shiftTiming, joiningDate } = req.body;
  if (!name || !email || !password) { res.status(400).json({ error: 'Name, email and password required' }); return; }
  if (userQueries.findByEmail(email)) { res.status(409).json({ error: 'Email already in use' }); return; }

  const id   = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  userQueries.insert(id, name, email, hash, phone ?? null, role, department ?? null, employeeId ?? null, shiftTiming ?? null, joiningDate ?? null, null, 'active');
  res.status(201).json(safeUser(userQueries.findById(id)!));
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req: Request, res: Response): void => {
  const { id } = req.params;
  const existing = userQueries.findById(id);
  if (!existing) { res.status(404).json({ error: 'User not found' }); return; }

  const { name, phone, role, department, employeeId, shiftTiming, joiningDate, status } = req.body;
  userQueries.update(
    name        ?? existing.name,
    phone       ?? existing.phone,
    role        ?? existing.role,
    department  ?? existing.department,
    employeeId  ?? existing.employeeId,
    shiftTiming ?? existing.shiftTiming,
    joiningDate ?? existing.joiningDate,
    status      ?? existing.status,
    id,
  );
  res.json(safeUser(userQueries.findById(id)!));
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req: Request, res: Response): void => {
  const { id } = req.params;
  if (!userQueries.findById(id)) { res.status(404).json({ error: 'User not found' }); return; }
  userQueries.softDelete(id);
  res.json({ success: true });
});

app.put('/api/users/:id/password', requireAuth, requireAdmin, (req: Request, res: Response): void => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password) { res.status(400).json({ error: 'Password required' }); return; }
  if (!userQueries.findById(id)) { res.status(404).json({ error: 'User not found' }); return; }
  userQueries.updatePassword(bcrypt.hashSync(password, 10), id);
  res.json({ success: true });
});

// Aliases used by older frontend code (/api/admin/employees/:id)
app.put('/api/admin/employees/:id', requireAuth, requireAdmin, (req: Request, res: Response): void => {
  const { id } = req.params;
  const existing = userQueries.findById(id);
  if (!existing) { res.status(404).json({ error: 'User not found' }); return; }
  const { name, phone, role, department, employeeId, shiftTiming, joiningDate, status } = req.body;
  userQueries.update(
    name        ?? existing.name,
    phone       ?? existing.phone,
    role        ?? existing.role,
    department  ?? existing.department,
    employeeId  ?? existing.employeeId,
    shiftTiming ?? existing.shiftTiming,
    joiningDate ?? existing.joiningDate,
    status      ?? existing.status,
    id,
  );
  res.json(safeUser(userQueries.findById(id)!));
});

app.delete('/api/admin/employees/:id', requireAuth, requireAdmin, (req: Request, res: Response): void => {
  const { id } = req.params;
  if (!userQueries.findById(id)) { res.status(404).json({ error: 'User not found' }); return; }
  userQueries.softDelete(id);
  res.json({ success: true });
});

// ─── Task routes ─────────────────────────────────────────────────────────────

app.get('/api/tasks', requireAuth, (req: AuthRequest, res: Response): void => {
  const rows =
    req.user!.role === 'admin'    ? taskQueries.all() :
    req.user!.role === 'teamlead' ? taskQueries.byAssigner(req.user!.id) :
                                    taskQueries.forAssignee(req.user!.id);
  res.json(rows.map(formatTask));
});

app.post('/api/tasks', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { title, description, assignedTo, priority = 'medium', dueDate, status = 'pending', groupId = null, groupName = null } = req.body;
  if (!title || !assignedTo) { res.status(400).json({ error: 'Title and assignedTo required' }); return; }
  if (!userQueries.findById(assignedTo)) { res.status(404).json({ error: 'Assigned user not found' }); return; }

  const id  = randomUUID();
  const now = new Date().toISOString();
  taskQueries.insert(id, title, description ?? null, assignedTo, req.user!.id, req.user!.name, priority, dueDate ?? null, status, now, groupId, groupName);
  res.status(201).json(formatTask(taskQueries.findById(id)!));
});

app.put('/api/tasks/:id', requireAuth, (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const task = taskQueries.findById(id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const role = req.user!.role;
  const uid  = req.user!.id;

  if (role === 'user') {
    if (task.assignedTo !== uid) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { status } = req.body;
    if (status) taskQueries.updateStatus(status, new Date().toISOString(), id);
    res.json(formatTask(taskQueries.findById(id)!));
    return;
  }

  if (role === 'teamlead' && task.assignedBy !== uid) {
    res.status(403).json({ error: 'You can only edit tasks you assigned' }); return;
  }

  const { title, description, assignedTo, priority, dueDate, status } = req.body;
  taskQueries.updateFull(
    title       ?? task.title,
    description ?? task.description,
    assignedTo  ?? task.assignedTo,
    priority    ?? task.priority,
    dueDate     ?? task.dueDate,
    status      ?? task.status,
    new Date().toISOString(),
    id,
  );
  res.json(formatTask(taskQueries.findById(id)!));
});

app.delete('/api/tasks/:id', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const task = taskQueries.findById(id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (req.user!.role === 'teamlead' && task.assignedBy !== req.user!.id) {
    res.status(403).json({ error: 'You can only delete tasks you assigned' }); return;
  }
  taskQueries.delete(id);
  res.json({ success: true });
});

// ─── Task submission (employee posts answer) ──────────────────────────────────
app.post('/api/tasks/:id/submit', requireAuth, (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const { submission } = req.body;
  if (!submission?.trim()) { res.status(400).json({ error: 'Submission cannot be empty' }); return; }
  const task = taskQueries.findById(id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.assignedTo !== req.user!.id) { res.status(403).json({ error: 'This task is not assigned to you' }); return; }
  const now = new Date().toISOString();
  taskQueries.submit(submission.trim(), now, 'completed', now, id);
  res.json(formatTask({ ...task, submission: submission.trim(), submittedAt: now, status: 'completed', updatedAt: now }));
});

// ─── Group routes ─────────────────────────────────────────────────────────────

function formatGroup(g: import('./db.js').DBGroup & { memberIds?: string[] }) {
  return {
    id:          g.id,
    name:        g.name,
    description: g.description ?? '',
    color:       g.color,
    createdBy:   g.createdBy,
    createdAt:   g.createdAt,
    memberIds:   g.memberIds ?? groupMemberQueries.membersOf(g.id),
  };
}

// GET /api/groups — all groups visible to this user
app.get('/api/groups', requireAuth, (req: AuthRequest, res: Response): void => {
  const role = req.user!.role;
  const rows = role === 'admin'
    ? groupQueries.all()
    : groupQueries.byCreator(req.user!.id);
  res.json(rows.map(formatGroup));
});

// POST /api/groups — create a group
app.post('/api/groups', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { name, description, color = '#6366f1' } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Group name required' }); return; }
  const id  = randomUUID();
  const now = new Date().toISOString();
  groupQueries.insert(id, name.trim(), description ?? null, color, req.user!.id, now);
  res.status(201).json(formatGroup(groupQueries.findById(id)!));
});

// PUT /api/groups/:id — rename / recolor
app.put('/api/groups/:id', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const existing = groupQueries.findById(id);
  if (!existing) { res.status(404).json({ error: 'Group not found' }); return; }
  if (req.user!.role !== 'admin' && existing.createdBy !== req.user!.id) {
    res.status(403).json({ error: 'You can only edit groups you created' }); return;
  }
  const { name, description, color } = req.body;
  groupQueries.update(
    name        ?? existing.name,
    description ?? existing.description,
    color       ?? existing.color,
    id,
  );
  res.json(formatGroup(groupQueries.findById(id)!));
});

// DELETE /api/groups/:id
app.delete('/api/groups/:id', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const existing = groupQueries.findById(id);
  if (!existing) { res.status(404).json({ error: 'Group not found' }); return; }
  if (req.user!.role !== 'admin' && existing.createdBy !== req.user!.id) {
    res.status(403).json({ error: 'You can only delete groups you created' }); return;
  }
  groupMemberQueries.clear(id);
  groupQueries.delete(id);
  res.json({ success: true });
});

// PUT /api/groups/:id/members — replace entire member list
app.put('/api/groups/:id/members', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  if (!groupQueries.findById(id)) { res.status(404).json({ error: 'Group not found' }); return; }
  const { memberIds } = req.body; // string[]
  if (!Array.isArray(memberIds)) { res.status(400).json({ error: 'memberIds must be an array' }); return; }
  groupMemberQueries.clear(id);
  for (const uid of memberIds) {
    if (userQueries.findById(uid)) groupMemberQueries.add(id, uid);
  }
  res.json(formatGroup(groupQueries.findById(id)!));
});

// POST /api/groups/:id/members/:userId — add single member
app.post('/api/groups/:id/members/:userId', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { id, userId } = req.params;
  if (!groupQueries.findById(id))   { res.status(404).json({ error: 'Group not found' }); return; }
  if (!userQueries.findById(userId)) { res.status(404).json({ error: 'User not found' }); return; }
  groupMemberQueries.add(id, userId);
  res.json(formatGroup(groupQueries.findById(id)!));
});

// DELETE /api/groups/:id/members/:userId — remove single member
app.delete('/api/groups/:id/members/:userId', requireAuth, requireTeamLead, (req: AuthRequest, res: Response): void => {
  const { id, userId } = req.params;
  if (!groupQueries.findById(id)) { res.status(404).json({ error: 'Group not found' }); return; }
  groupMemberQueries.remove(id, userId);
  res.json(formatGroup(groupQueries.findById(id)!));
});

// ─── Notification routes ──────────────────────────────────────────────────────

app.get('/api/notifications', requireAuth, (req: AuthRequest, res: Response): void => {
  const notifs = notificationQueries.forUser(req.user!.id);
  res.json(notifs.map(n => ({
    ...n,
    isRead:   n.isRead === 1,
    metadata: n.metadata ? JSON.parse(n.metadata) : null,
  })));
});

app.put('/api/notifications/read', requireAuth, (req: AuthRequest, res: Response): void => {
  notificationQueries.markAllRead(req.user!.id);
  res.json({ success: true });
});

app.put('/api/notifications/:id/read', requireAuth, (req: AuthRequest, res: Response): void => {
  notificationQueries.markRead(req.params.id);
  res.json({ success: true });
});

// ─── Auto punch-out scheduler ─────────────────────────────────────────────────
// Warning notification at 6:30 PM, auto punch-out at 6:40 PM every day.

function getUsersStillPunchedIn(): Array<{ id: string; name: string }> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const allUsers = userQueries.findByRole('user').filter(u => u.status === 'active');
  const todayLogs = logQueries.allOnDate(todayStr);

  return allUsers.filter(u => {
    const uLogs = todayLogs
      .filter(l => l.userId === u.id &&
        !['idle_start', 'idle_end', 'location_update', 'daily_report'].includes(l.type))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (uLogs.length === 0) return false;
    return uLogs[uLogs.length - 1].type !== 'logout';
  }).map(u => ({ id: u.id, name: u.name }));
}

setInterval(() => {
  const now = new Date();
  const h   = now.getHours();
  const m   = now.getMinutes();
  const ts  = now.toISOString();
  const sinceTs = new Date(now.getTime() - 90_000).toISOString(); // last 90 s dedup window

  // ── 6:30 PM — warning notification ──────────────────────────────────────────
  if (h === 18 && m === 30) {
    const stillIn    = getUsersStillPunchedIn();
    const recipients = [
      ...userQueries.findByRole('teamlead'),
      ...userQueries.findByRole('admin'),
    ];

    // Notify each employee still punched in
    for (const emp of stillIn) {
      if (!notificationQueries.existsSince(emp.id, 'auto_punchout_warning', sinceTs)) {
        notificationQueries.insert(
          randomUUID(), emp.id,
          'auto_punchout_warning',
          '⚠️ Auto Punch-Out in 10 Minutes',
          'You will be automatically punched out at 6:40 PM. Please save your work.',
          ts, null,
        );
      }
    }

    // Notify team leads / admins
    if (stillIn.length > 0) {
      for (const lead of recipients) {
        if (!notificationQueries.existsSince(lead.id, 'auto_punchout_warning_lead', sinceTs)) {
          notificationQueries.insert(
            randomUUID(), lead.id,
            'auto_punchout_warning_lead',
            '⚠️ Auto Punch-Out Warning',
            `${stillIn.length} employee${stillIn.length > 1 ? 's' : ''} still punched in — auto punch-out at 6:40 PM.`,
            ts, JSON.stringify({ count: stillIn.length, names: stillIn.map(e => e.name) }),
          );
        }
      }
    }
    console.log(`[AutoPunchOut] 6:30 PM warning sent to ${stillIn.length} employee(s).`);
  }

  // ── 6:40 PM — auto punch-out ─────────────────────────────────────────────────
  if (h === 18 && m === 40) {
    const stillIn    = getUsersStillPunchedIn();
    const recipients = [
      ...userQueries.findByRole('teamlead'),
      ...userQueries.findByRole('admin'),
    ];

    for (const emp of stillIn) {
      if (notificationQueries.existsSince(emp.id, 'auto_punchout', sinceTs)) continue;
      // Insert auto logout log
      logQueries.insert(randomUUID(), emp.id, 'logout', ts, 'Auto punch-out at 6:40 PM', null, null);
      // Notify employee
      notificationQueries.insert(
        randomUUID(), emp.id,
        'auto_punchout',
        '🕔 Automatically Punched Out',
        'You were automatically punched out at 6:40 PM because you did not punch out manually.',
        ts, null,
      );
    }

    // Summary notification to team leads / admins
    if (stillIn.length > 0) {
      for (const lead of recipients) {
        if (!notificationQueries.existsSince(lead.id, 'auto_punchout_summary', sinceTs)) {
          notificationQueries.insert(
            randomUUID(), lead.id,
            'auto_punchout_summary',
            '🕔 Auto Punch-Out Complete',
            `${stillIn.length} employee${stillIn.length > 1 ? 's were' : ' was'} automatically punched out at 6:40 PM: ${stillIn.map(e => e.name).join(', ')}.`,
            ts, JSON.stringify({ count: stillIn.length, names: stillIn.map(e => e.name) }),
          );
        }
      }
    }
    console.log(`[AutoPunchOut] 6:40 PM — auto punched out ${stillIn.length} employee(s).`);
  }
}, 60_000); // runs every minute

// ─── Serve Vite build ─────────────────────────────────────────────────────────

const DIST = path.join(__dirname, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('API is running. Open http://localhost:5173 for the UI.'));
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀  TimeTracker Pro API  →  http://localhost:${PORT}`);
  console.log(`📦  SQLite database      →  data/timetracker.db`);
  console.log(`🖥️   Open UI             →  http://localhost:5173\n`);
});
