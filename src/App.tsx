import React, { useState, useEffect, createContext, useContext, useMemo, ReactNode, FormEvent } from 'react';
import { 
  BrowserRouter, 
  Routes, 
  Route, 
  Navigate, 
  useNavigate,
  Link,
  useLocation
} from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  LogOut, 
  User, 
  Users,
  LogIn,
  Activity,
  CheckCircle,
  Zap,
  MapPin, 
  Calendar,
  Coffee,
  ChevronRight,
  ShieldCheck,
  Search,
  Filter,
  Menu,
  X,
  ChevronLeft,
  MessageSquare,
  TrendingUp,
  Download,
  Trash2,
  ExternalLink,
  ChevronRight as ChevronRightIcon,
  Mail,
  Phone,
  Briefcase,
  Key,
  Plus,
  ClipboardList,
  Flag,
  AlertCircle,
  Clock,
  Sun,
  Sunset,
  CheckSquare,
  Circle,
  UserCog,
  Edit2,
  Bell,
  PlayCircle,
  Pause,
  Timer,
  ListTodo,
  Eye,
  EyeOff,
  Monitor,
  WifiOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  isWithinInterval, 
  startOfDay, 
  endOfDay, 
  differenceInMinutes, 
  parseISO,
  subDays,
  eachDayOfInterval,
  isSameDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  addMonths,
  subMonths,
  addDays,
  isToday
} from 'date-fns';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { User as UserType, TimeLog, Task, Group } from './types';

// --- Global fetch helper: clears session on 401 so stale tokens auto-logout ---
async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401) {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  return res;
}

// --- Work Schedule ---
const WORK_SCHEDULE = {
  loginTime:     { h: 9,  m: 30, label: '9:30 AM' },
  morningBreak:  { startH: 11, startM: 0, endH: 11, endM: 15, label: '11:00 – 11:15 AM', duration: 15 },
  lunchBreak:    { startH: 13, startM: 30, endH: 14, endM: 0, label: '1:30 – 2:00 PM', duration: 30 },
  eveningBreak:  { startH: 16, startM: 30, endH: 16, endM: 45, label: '4:30 – 4:45 PM', duration: 15 },
  logoutTime:    { h: 18, m: 30, label: '6:30 PM' },
  requiredHours: 8,
};

// Returns which scheduled break window the current time falls in (±45 min tolerance)
const getActiveBreakWindow = (now: Date): 'morning' | 'lunch' | 'evening' | null => {
  const h = now.getHours();
  const m = now.getMinutes();
  const totalMins = h * 60 + m;
  const s = WORK_SCHEDULE;
  const inRange = (sh: number, sm: number, pad = 45) => {
    const start = sh * 60 + sm - pad;
    const end   = sh * 60 + sm + pad + 15; // +break duration
    return totalMins >= start && totalMins <= end;
  };
  if (inRange(s.morningBreak.startH, s.morningBreak.startM)) return 'morning';
  if (inRange(s.lunchBreak.startH, s.lunchBreak.startM)) return 'lunch';
  if (inRange(s.eveningBreak.startH, s.eveningBreak.startM)) return 'evening';
  return null;
};

// --- Utils ---

const IDLE_DEDUCT_MIN = 30; // only deduct sleep gaps longer than 30 minutes

const calculateTotalHours = (dailyLogs: TimeLog[]) => {
  if (dailyLogs.length === 0) return { hours: 0, minutes: 0, totalMinutes: 0, idleDeductedMinutes: 0 };

  let totalMinutes = 0;
  let idleDeductedMinutes = 0;
  let lastPunchIn: Date | null = null;
  let lastIdleStart: Date | null = null;

  // Sort all relevant logs by time — include idle events for sleep deduction
  const sorted = [...dailyLogs]
    .filter(l => !['location_update', 'daily_report'].includes(l.type))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  sorted.forEach(log => {
    const time = new Date(log.timestamp);

    if (log.type === 'login' || log.type === 'lunch_out' || log.type === 'break_end') {
      lastPunchIn = time;
      lastIdleStart = null; // clear any pending idle on resume events
    }
    else if (log.type === 'idle_start') {
      // Pause accumulation — system went to sleep
      if (lastPunchIn) {
        totalMinutes += differenceInMinutes(time, lastPunchIn);
        lastPunchIn = null;
      }
      lastIdleStart = time;
    }
    else if (log.type === 'idle_end') {
      if (lastIdleStart) {
        const gapMins = differenceInMinutes(time, lastIdleStart);
        if (gapMins >= IDLE_DEDUCT_MIN) {
          // Real sleep (≥20 min) — gap already excluded, record deduction
          idleDeductedMinutes += gapMins;
        } else {
          // Short gap (<20 min) — give benefit of doubt, add time back
          totalMinutes += gapMins;
        }
        lastIdleStart = null;
      }
      lastPunchIn = time; // resume work
    }
    else if ((log.type === 'logout' || log.type === 'lunch_in' || log.type === 'break_start') && lastPunchIn) {
      totalMinutes += differenceInMinutes(time, lastPunchIn);
      lastPunchIn = null;
      lastIdleStart = null;
    }
  });

  // Still working (no logout) — accumulate to now for today; cap at 6:40 PM for past days
  if (lastPunchIn && !lastIdleStart) {
    const punchDate = new Date(lastPunchIn);
    const now = new Date();
    const isToday = punchDate.toDateString() === now.toDateString();
    // For past days with no logout, cap at auto-punchout time (6:40 PM)
    const capTime = isToday ? now : new Date(
      punchDate.getFullYear(), punchDate.getMonth(), punchDate.getDate(), 18, 40, 0
    );
    totalMinutes += differenceInMinutes(capTime, lastPunchIn);
  }
  // Currently in sleep — if gap is still < 20 min, count it; else don't
  if (lastIdleStart && !lastPunchIn) {
    const idleDate = new Date(lastIdleStart);
    const now = new Date();
    const isToday = idleDate.toDateString() === now.toDateString();
    const capTime = isToday ? now : new Date(
      idleDate.getFullYear(), idleDate.getMonth(), idleDate.getDate(), 18, 40, 0
    );
    const gapNow = differenceInMinutes(capTime, lastIdleStart);
    if (isToday && gapNow < IDLE_DEDUCT_MIN) totalMinutes += gapNow;
    // else: past day or ≥20 min sleep — don't count
  }

  totalMinutes = Math.max(0, totalMinutes);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
    idleDeductedMinutes,
  };
};

const exportToCSV = (logs: TimeLog[], name: string = 'report') => {
  const headers = ['Type', 'Date', 'Time', 'Location', 'Note'];
  const rows = logs.map(l => [
    l.type,
    format(new Date(l.timestamp), 'yyyy-MM-dd'),
    format(new Date(l.timestamp), 'hh:mm:ss a'),
    l.location ? `${l.location.lat}, ${l.location.lng}` : 'N/A',
    l.note || ''
  ]);
  
  const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${name}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const MonthlyWorkCalendar = ({ logs }: { logs: TimeLog[] }) => {
  const [viewDate, setViewDate] = useState(new Date());
  const today = new Date();

  const daysMapping = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 0 });
    const end   = endOfWeek(endOfMonth(viewDate),   { weekStartsOn: 0 });
    const days  = eachDayOfInterval({ start, end });

    return days.map(day => {
      const dayStr  = format(day, 'yyyy-MM-dd');
      const dayLogs = logs.filter(l => l.timestamp.startsWith(dayStr));
      const { hours, minutes, totalMinutes } = calculateTotalHours(dayLogs);
      const isWeekend    = day.getDay() === 0 || day.getDay() === 6;
      const isPast       = day < today && !isToday(day);
      const isFuture     = day > today;
      const loginLog     = dayLogs.find(l => l.type === 'login');
      const logoutLog    = [...dayLogs].reverse().find(l => l.type === 'logout');
      const punchIn      = loginLog  ? format(new Date(loginLog.timestamp),  'h:mm a') : null;
      const punchOut     = logoutLog ? format(new Date(logoutLog.timestamp), 'h:mm a') : null;

      const isCurrentDay = isToday(day);
      let status: 'present' | 'half' | 'absent' | 'weekend' | 'future' = 'future';
      if (isFuture)        status = 'future';
      else if (isWeekend)  status = 'weekend';
      else if (isCurrentDay && loginLog) status = 'present'; // today with login → always present (still working)
      else if (totalMinutes >= 480)  status = 'present';   // ≥8h
      else if (totalMinutes >= 60)   status = 'half';      // 1–7.9h
      else if (loginLog)              status = 'half';     // has login but low hours (half day)
      else                            status = 'absent';

      return {
        date: day, hours, minutes, totalMinutes,
        isCurrentMonth: isSameMonth(day, viewDate),
        isToday: isToday(day),
        isWeekend, isPast, isFuture,
        punchIn, punchOut, status,
      };
    });
  }, [logs, viewDate]);

  // Monthly summary counts
  const workingDays  = daysMapping.filter(d => d.isCurrentMonth && !d.isWeekend && !d.isFuture);
  const presentCount = workingDays.filter(d => d.status === 'present').length;
  const halfCount    = workingDays.filter(d => d.status === 'half').length;
  const absentCount  = workingDays.filter(d => d.status === 'absent').length;

  const statusStyle = {
    present : 'bg-emerald-500',
    half    : 'bg-amber-400',
    absent  : 'bg-rose-400',
    weekend : 'bg-gray-100',
    future  : '',
  } as const;

  const cellBg = {
    present : 'bg-emerald-50  border-emerald-200',
    half    : 'bg-amber-50    border-amber-200',
    absent  : 'bg-rose-50     border-rose-200',
    weekend : 'bg-gray-50/60  border-gray-100',
    future  : 'bg-white       border-gray-100',
  } as const;

  return (
    <div className="w-full select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-xs font-black text-gray-700 flex items-center gap-2">
          <Calendar size={14} className="text-indigo-500" />
          {format(viewDate, 'MMMM yyyy')}
        </span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setViewDate(subMonths(viewDate, 1))}
            className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 transition-all">
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={() => setViewDate(addMonths(viewDate, 1))}
            className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 transition-all">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: 'Present', count: presentCount, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
          { label: 'Half Day', count: halfCount,    color: 'text-amber-600  bg-amber-50  border-amber-200' },
          { label: 'Absent',  count: absentCount,  color: 'text-rose-600   bg-rose-50   border-rose-200' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border px-2 py-1.5 text-center ${s.color}`}>
            <div className="text-lg font-black leading-none">{s.count}</div>
            <div className="text-[9px] font-bold uppercase tracking-wide mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-center text-[9px] font-black text-gray-400 uppercase tracking-tighter py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {daysMapping.map((item, i) => {
          return (
            <div
              key={i}
              title={
                item.status === 'present' ? `✅ Present · ${item.hours}h ${item.minutes}m\nIn: ${item.punchIn}  Out: ${item.punchOut ?? '—'}` :
                item.status === 'half'    ? `🕐 Half Day · ${item.hours}h ${item.minutes}m\nIn: ${item.punchIn}  Out: ${item.punchOut ?? '—'}` :
                item.status === 'absent'  ? '❌ Absent' :
                item.status === 'weekend' ? 'Weekend' : ''
              }
              className={`
                relative rounded-xl border p-1 flex flex-col items-center gap-0.5 transition-all cursor-default
                h-14
                ${item.isCurrentMonth ? cellBg[item.status] : 'bg-white/40 border-gray-50 opacity-40'}
                ${item.isToday ? 'ring-2 ring-indigo-500 ring-offset-1 z-10' : ''}
              `}
            >
              {/* Date number */}
              <span className={`text-[10px] font-black leading-none mt-0.5
                ${item.isToday ? 'text-indigo-600' : item.isCurrentMonth ? 'text-gray-700' : 'text-gray-300'}
              `}>
                {format(item.date, 'd')}
              </span>

              {/* Status dot / badge */}
              {item.isCurrentMonth && item.status !== 'future' && (
                <div className={`w-1.5 h-1.5 rounded-full ${statusStyle[item.status]}`} />
              )}

              {/* Hours label */}
              {item.isCurrentMonth && item.totalMinutes > 0 && (
                <span className={`text-[8px] font-black leading-none
                  ${item.status === 'present' ? 'text-emerald-600' : 'text-amber-600'}
                `}>
                  {item.hours}h{item.minutes > 0 ? `${item.minutes}m` : ''}
                </span>
              )}

              {/* Absent X mark */}
              {item.isCurrentMonth && item.status === 'absent' && (
                <span className="text-[9px] font-black text-rose-400 leading-none">✕</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 px-1 flex-wrap">
        {[
          { dot: 'bg-emerald-500', label: 'Present (≥8h)' },
          { dot: 'bg-amber-400',   label: 'Half Day' },
          { dot: 'bg-rose-400',    label: 'Absent' },
          { dot: 'bg-gray-200',    label: 'Weekend' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${l.dot}`} />
            <span className="text-[9px] text-gray-400 font-semibold">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const AdminAttendanceCalendar = ({ logs, users, onDateClick }: { logs: TimeLog[], users: UserType[], onDateClick: (date: Date) => void }) => {
  const [viewDate, setViewDate] = useState(new Date());

  const daysMapping = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start, end });

    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dayLogs = logs.filter(l => format(new Date(l.timestamp), 'yyyy-MM-dd') === dayStr);
      
      const employeeUsers = users.filter(u => u.role === 'user' && !u.isDeleted);

      // Per-employee status for the day
      let presentCount = 0;      // punched in (had a login)
      let punchedOutCount = 0;   // completed day (had a logout)
      let stillWorkingCount = 0; // punched in but NOT yet out
      let totalMinutes = 0;

      employeeUsers.forEach(u => {
        const uLogs = dayLogs.filter(l => l.userId === u.id);
        const hasLogin  = uLogs.some(l => l.type === 'login');
        const hasLogout = uLogs.some(l => l.type === 'logout');
        if (hasLogin) {
          presentCount++;
          if (hasLogout) punchedOutCount++;
          else stillWorkingCount++;
        }
        const { totalMinutes: uMins } = calculateTotalHours(uLogs);
        totalMinutes += uMins;
      });

      const totalHours = totalMinutes / 60;
      const absentCount = employeeUsers.length - presentCount;
      
      // Late punch-ins (after 9:35 AM — 5-min grace)
      const lateCount = dayLogs.filter(l => {
        if (l.type !== 'login') return false;
        const time = new Date(l.timestamp);
        return time.getHours() > 9 || (time.getHours() === 9 && time.getMinutes() > 35);
      }).length;

      const attendancePercent = employeeUsers.length > 0
        ? (presentCount / employeeUsers.length) * 100
        : 0;

      return {
        date: day,
        presentCount,
        punchedOutCount,
        stillWorkingCount,
        absentCount,
        totalEmployees: employeeUsers.length,
        totalHours,
        lateCount,
        attendancePercent,
        isCurrentMonth: isSameMonth(day, viewDate),
        isToday: isToday(day)
      };
    });
  }, [logs, users, viewDate]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6 px-1">
        <div className="flex items-center gap-4">
          <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest">
            {format(viewDate, 'MMMM yyyy')}
          </h4>
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Full (90%+)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-amber-400" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Partial (50%+)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Low (&lt;50%)</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            type="button"
            onClick={() => setViewDate(subMonths(viewDate, 1))} 
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-indigo-600 border border-gray-100 transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <button 
            type="button"
            onClick={() => setViewDate(addMonths(viewDate, 1))} 
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-indigo-600 border border-gray-100 transition-all"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="bg-gray-50 p-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">{d}</div>
        ))}
        {daysMapping.map((item, i) => {
          let statusColor = 'bg-white';
          if (item.presentCount > 0) {
            if (item.attendancePercent >= 90) statusColor = 'bg-emerald-50/30';
            else if (item.attendancePercent >= 50) statusColor = 'bg-amber-50/30';
            else statusColor = 'bg-red-50/30';
          }

          return (
            <div 
              key={i} 
              onClick={() => onDateClick(item.date)}
              className={`
                ${statusColor} p-2 h-24 sm:h-32 flex flex-col transition-all cursor-pointer hover:bg-indigo-50/50 group relative
                ${item.isCurrentMonth ? '' : 'opacity-40'}
              `}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded transition-all ${item.isToday ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 group-hover:text-indigo-600'}`}>
                  {format(item.date, 'd')}
                </span>
                {item.lateCount > 0 && (
                  <span className="text-[10px] font-medium text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded flex items-center gap-1 border border-rose-100">
                    {item.lateCount} Late
                  </span>
                )}
              </div>

              {item.presentCount > 0 ? (
                <div className="space-y-1 mt-auto">
                  {/* Attendance % bar */}
                  <div className="w-full bg-gray-100 rounded-full h-1 mb-1">
                    <div
                      className={`h-1 rounded-full transition-all ${item.attendancePercent >= 90 ? 'bg-emerald-500' : item.attendancePercent >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${Math.min(100, item.attendancePercent)}%` }}
                    />
                  </div>

                  {/* Always-visible: present count + hours */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-400">Present</span>
                    <span className="text-xs font-bold text-gray-700">{item.presentCount}/{item.totalEmployees}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-400">Hours</span>
                    <span className="text-xs font-bold text-indigo-600">{item.totalHours.toFixed(1)}h</span>
                  </div>

                  {/* On hover: working vs finished vs absent */}
                  <div className="grid grid-cols-3 gap-0.5 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-emerald-50 text-emerald-700 rounded p-1 text-center border border-emerald-100">
                      <p className="text-[8px] font-bold leading-none">Working</p>
                      <p className="text-[11px] font-black mt-0.5">{item.stillWorkingCount}</p>
                    </div>
                    <div className="bg-sky-50 text-sky-700 rounded p-1 text-center border border-sky-100">
                      <p className="text-[8px] font-bold leading-none">Finished</p>
                      <p className="text-[11px] font-black mt-0.5">{item.punchedOutCount}</p>
                    </div>
                    <div className="bg-rose-50 text-rose-700 rounded p-1 text-center border border-rose-100">
                      <p className="text-[8px] font-bold leading-none">Absent</p>
                      <p className="text-[11px] font-black mt-0.5">{item.absentCount}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-auto items-center justify-center hidden sm:flex">
                  <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest italic">No Data</p>
                </div>
              )}
              
              {/* Color Stripe */}
              {item.presentCount > 0 && (
                <div className={`absolute bottom-0 left-0 right-0 h-1 transition-all ${item.attendancePercent >= 90 ? 'bg-emerald-500' : item.attendancePercent >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};


const DayAttendanceModal = ({ date, isOpen, onClose, token }: { date: Date, isOpen: boolean, onClose: () => void, token: string | null }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, present, late, absent, half-day

  useEffect(() => {
    if (isOpen && token) {
      const fetchDayDetail = async () => {
        setLoading(true);
        try {
          const res = await apiFetch(`/api/admin/attendance/${format(date, 'yyyy-MM-dd')}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const json = await res.json();
          setData(json);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      fetchDayDetail();
    }
  }, [isOpen, date, token]);

  // Late = punched in after 9:35 AM (9:30 scheduled + 5-min grace)
  const isLate = (item: any): boolean => {
    if (!item.punchInTime) return false;
    const t = new Date(item.punchInTime);
    return t.getHours() > 9 || (t.getHours() === 9 && t.getMinutes() > 35);
  };

  const filteredData = data.filter(item => {
    const matchesSearch = item.user.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === 'all'    ? true :
      filter === 'late'   ? isLate(item) :
      filter === 'present'? item.status !== 'absent' :
                            item.status === filter;
    return matchesSearch && matchesFilter;
  });

  const exportReport = () => {
    const headers = ['Employee Name', 'Punch In', 'Punch Out', 'Duration', 'Status', 'Notes'];
    const rows = filteredData.map(item => {
      const { hours, minutes, totalMinutes } = calculateTotalHours(item.logs);
      
      // Calculate Break Time
      let breakMinutes = 0;
      let lastLunchIn: Date | null = null;
      item.logs.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).forEach((l: any) => {
        if (l.type === 'lunch_in') lastLunchIn = new Date(l.timestamp);
        else if (l.type === 'lunch_out' && lastLunchIn) {
          breakMinutes += differenceInMinutes(new Date(l.timestamp), lastLunchIn);
          lastLunchIn = null;
        }
      });
      
      const overtimeMins = Math.max(0, totalMinutes - 480);

      return [
        item.user.name,
        item.punchInTime ? format(new Date(item.punchInTime), 'hh:mm a') : '-',
        item.punchOutTime ? format(new Date(item.punchOutTime), 'hh:mm a') : '-',
        `${hours}h ${minutes}m`,
        item.status.toUpperCase(),
        `${Math.floor(breakMinutes/60)}h ${breakMinutes%60}m`,
        `${Math.floor(overtimeMins/60)}h ${overtimeMins%60}m`
      ];
    });

    const csvContent = [['Employee Name', 'Punch In', 'Punch Out', 'Duration', 'Status', 'Break Time', 'Overtime'], ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `attendance_${format(date, 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white w-full max-w-6xl max-h-[92vh] rounded-3xl shadow-2xl relative flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-indigo-50/30">
              <div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                  <Calendar className="text-indigo-600" />
                  Detailed Report: {format(date, 'MMMM do, yyyy')}
                </h3>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Daily Workforce Performance Analysis</p>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-red-500 transition-all border border-transparent hover:border-gray-100 shadow-sm"
              >
                <X size={24} />
              </button>
            </div>

            {/* Filters */}
            <div className="p-6 border-b border-gray-100 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              <div className="md:col-span-5 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Search employee name..."
                  className="w-full pl-11 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all shadow-inner"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="md:col-span-4 flex gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
                {['all', 'present', 'late', 'absent'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all whitespace-nowrap ${filter === f ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-gray-200 text-gray-400 hover:border-indigo-400 hover:text-indigo-600'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="md:col-span-3 flex justify-end gap-2">
                <Button variant="secondary" icon={Download} onClick={exportReport} className="text-xs h-10 px-4 rounded-xl">Export Report</Button>
              </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-y-auto p-0 min-h-[300px]">
              {loading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-20 gap-4">
                   <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                   <p className="text-sm font-black text-gray-400 uppercase tracking-widest animate-pulse">Compiling Daily Metrics...</p>
                </div>
              ) : filteredData.length === 0 ? (
                <div className="py-24 text-center">
                   <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-200">
                     <Search size={40} />
                   </div>
                   <p className="font-black text-gray-300 uppercase tracking-widest text-sm">No results match your criteria</p>
                </div>
              ) : (
                <table className="w-full text-left">
                   <thead className="bg-gray-50/50 sticky top-0 z-10 backdrop-blur-md">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee</th>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Punch In</th>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Punch Out</th>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Shift Hours</th>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Break</th>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Overtime</th>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Details</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100">
                      {filteredData.map(item => {
                        const { hours, minutes, totalMinutes } = calculateTotalHours(item.logs);
                        
                        // Break calculation
                        let breakMinutes = 0;
                        let lastLunchIn: Date | null = null;
                        item.logs.forEach((l: any) => {
                          if (l.type === 'lunch_in') lastLunchIn = new Date(l.timestamp);
                          else if (l.type === 'lunch_out' && lastLunchIn) {
                            breakMinutes += differenceInMinutes(new Date(l.timestamp), lastLunchIn);
                            lastLunchIn = null;
                          }
                        });
                        const overtimeMins = Math.max(0, totalMinutes - 480);

                        const derivedStatus = isLate(item) && item.status !== 'absent' ? 'late' : item.status;
                        const statusColors: any = {
                          present:  'bg-emerald-50 text-emerald-600',
                          left:     'bg-sky-50 text-sky-600',
                          late:     'bg-amber-50 text-amber-600 ring-1 ring-amber-100',
                          absent:   'bg-red-50 text-red-600',
                          on_break: 'bg-purple-50 text-purple-600',
                          'half-day': 'bg-indigo-50 text-indigo-600',
                        };
                        
                        return (
                          <tr key={item.user.id} className="hover:bg-indigo-50/20 transition-all group">
                             <td className="px-6 py-4">
                               <div className="flex items-center gap-3">
                                 <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-xl flex items-center justify-center font-black group-hover:scale-110 transition-transform">
                                   {item.user.name.charAt(0)}
                                 </div>
                                 <div className="overflow-hidden">
                                   <p className="text-sm font-black text-gray-900 truncate tracking-tight">{item.user.name}</p>
                                   <p className="text-[10px] text-gray-400 truncate">{item.user.email}</p>
                                 </div>
                               </div>
                             </td>
                             <td className="px-6 py-4">
                               <div className="flex items-center gap-2">
                                 <div className="p-1 px-1.5 bg-emerald-50 rounded text-emerald-600">
                                   <ChevronRightIcon size={12} />
                                 </div>
                                 <span className="text-xs font-bold text-gray-700">{item.punchInTime ? format(new Date(item.punchInTime), 'hh:mm a') : '--:--'}</span>
                               </div>
                             </td>
                             <td className="px-6 py-4">
                               <div className="flex items-center gap-2">
                                 <div className="p-1 px-1.5 bg-red-50 rounded text-red-600">
                                   <ChevronLeft size={12} />
                                 </div>
                                 <span className="text-xs font-bold text-gray-700">{item.punchOutTime ? format(new Date(item.punchOutTime), 'hh:mm a') : '--:--'}</span>
                               </div>
                             </td>
                             <td className="px-6 py-4">
                               <div className="flex flex-col">
                                 <span className="text-xs font-black text-indigo-700">{hours}h {minutes}m</span>
                                 <div className="w-16 h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min((hours * 60 + minutes) / 480 * 100, 100)}%` }} />
                                 </div>
                               </div>
                             </td>
                             <td className="px-6 py-4 text-center">
                               <span className="text-[10px] font-bold text-gray-500">{Math.floor(breakMinutes/60)}h {breakMinutes%60}m</span>
                             </td>
                             <td className="px-6 py-4 text-center">
                               <span className={`text-[10px] font-black ${overtimeMins > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                                 {Math.floor(overtimeMins/60)}h {overtimeMins%60}m
                               </span>
                             </td>
                             <td className="px-6 py-4">
                               <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${statusColors[derivedStatus] ?? 'bg-gray-50 text-gray-500'}`}>
                                 {derivedStatus}
                               </span>
                             </td>
                             <td className="px-6 py-4 text-right">
                               <button className="text-indigo-400 hover:text-indigo-600 transition-colors">
                                 <ExternalLink size={18} />
                               </button>
                             </td>
                          </tr>
                        );
                      })}
                   </tbody>
                </table>
              )}
            </div>

            {/* Footer Stats */}
            {!loading && (
              <div className="p-6 bg-gray-50 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-6">
                 <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Present</p>
                    <p className="text-xl font-black text-emerald-600">{data.filter(i => i.status !== 'absent').length}</p>
                 </div>
                 <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Late Arrivals</p>
                    <p className="text-xl font-black text-amber-500">{data.filter(i => isLate(i) && i.status !== 'absent').length}</p>
                 </div>
                 <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Absentees</p>
                    <p className="text-xl font-black text-red-500">{data.filter(i => i.status === 'absent').length}</p>
                 </div>
                 <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Man-Hours</p>
                    <p className="text-xl font-black text-indigo-700">
                      {(() => {
                        let total = 0;
                        data.forEach(i => total += calculateTotalHours(i.logs).totalMinutes);
                        return `${Math.floor(total/60)}h ${total%60}m`;
                      })()}
                    </p>
                 </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const AddEmployeeModal = ({ isOpen, onClose, token, onRefresh }: { isOpen: boolean, onClose: () => void, token: string | null, onRefresh: () => void }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'user',
    department: 'OPERATIONS',
    employeeId: '',
    shiftTiming: '09:00 AM - 06:00 PM',
    joiningDate: format(new Date(), 'yyyy-MM-dd')
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      
      const json = await res.json();
      if (res.ok) {
        onRefresh();
        onClose();
        // Reset form
        setFormData({
            name: '',
            email: '',
            phone: '',
            password: '',
            role: 'user',
            department: 'OPERATIONS',
            employeeId: '',
            shiftTiming: '09:00 AM - 06:00 PM',
            joiningDate: format(new Date(), 'yyyy-MM-dd')
        });
      } else {
        setError(json.error || 'Failed to create employee');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl shadow-2xl relative flex flex-col overflow-hidden"
          >
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-indigo-50/30">
              <div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                  <User size={24} className="text-indigo-600" />
                  Add New Employee
                </h3>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Register a new workforce member</p>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-red-500 transition-all border border-transparent hover:border-gray-100 shadow-sm"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
              {error && (
                <div className="p-4 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2">
                  <X size={16} />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Name */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Full Name *</label>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <input 
                      required
                      type="text" 
                      placeholder="John Doe"
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                </div>

                {/* Employee ID */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Employee ID *</label>
                  <div className="relative group">
                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <input 
                      required
                      type="text" 
                      placeholder="EMP-001"
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.employeeId}
                      onChange={e => setFormData({...formData, employeeId: e.target.value})}
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Email Address *</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <input 
                      required
                      type="email" 
                      placeholder="john@company.com"
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Initial Password *</label>
                  <div className="relative group">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className="w-full pl-11 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Phone Number</label>
                  <div className="relative group">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <input 
                      type="tel" 
                      placeholder="+1 (555) 000-0000"
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.phone}
                      onChange={e => setFormData({...formData, phone: e.target.value})}
                    />
                  </div>
                </div>

                {/* Department */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Department</label>
                  <div className="relative group">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <select 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white appearance-none"
                      value={formData.department}
                      onChange={e => setFormData({...formData, department: e.target.value})}
                    >
                      <option value="OPERATIONS">Operations</option>
                      <option value="SALES">Sales</option>
                      <option value="ENGINEERING">Engineering</option>
                      <option value="MARKETING">Marketing</option>
                      <option value="HR">Human Resources</option>
                    </select>
                  </div>
                </div>

                {/* Role */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Role</label>
                  <div className="relative group">
                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <select
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white appearance-none"
                      value={formData.role}
                      onChange={e => setFormData({...formData, role: e.target.value})}
                    >
                      <option value="user">Employee</option>
                      <option value="teamlead">Team Lead</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>

                {/* Shift Timing */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Shift Timing</label>
                  <div className="relative group">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <input
                      type="text"
                      placeholder="09:30 AM - 06:30 PM"
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.shiftTiming}
                      onChange={e => setFormData({...formData, shiftTiming: e.target.value})}
                    />
                  </div>
                </div>

                {/* Joining Date */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Joining Date</label>
                  <div className="relative group">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                    <input 
                      type="date" 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.joiningDate}
                      onChange={e => setFormData({...formData, joiningDate: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100 flex gap-4">
                <Button 
                  type="button" 
                  variant="ghost" 
                  className="flex-1 rounded-lg h-11 font-semibold text-xs border border-gray-200 text-gray-700 hover:bg-gray-50"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  className="flex-[2] rounded-lg h-11 font-semibold text-xs text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm border-none"
                  disabled={loading}
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Provisioning...
                    </div>
                  ) : 'Register Employee'}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const EditEmployeeModal = ({ user, isOpen, onClose, token, onRefresh }: { user: UserType | null, isOpen: boolean, onClose: () => void, token: string | null, onRefresh: () => void }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'user',
    department: 'OPERATIONS',
    employeeId: '',
    shiftTiming: '09:00 AM - 06:00 PM',
    joiningDate: '',
    status: 'active'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        role: user.role || 'user',
        department: user.department || 'OPERATIONS',
        employeeId: user.employeeId || '',
        shiftTiming: user.shiftTiming || '09:00 AM - 06:00 PM',
        joiningDate: user.joiningDate || '',
        status: user.status || 'active'
      });
    }
  }, [user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !user) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(formData)
      });
      
      const json = await res.json();
      if (res.ok) {
        onRefresh();
        onClose();
      } else {
        setError(json.error || 'Failed to update employee');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl shadow-2xl relative flex flex-col overflow-hidden"
          >
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-amber-50/30">
              <div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                  <User size={24} className="text-amber-600" />
                  Edit Employee Profile
                </h3>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Modify account details and permissions</p>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-red-500 transition-all border border-transparent hover:border-gray-100 shadow-sm"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
              {error && (
                <div className="p-4 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2">
                  <X size={16} />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Name */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Full Name *</label>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-amber-600 transition-colors" size={18} />
                    <input 
                      required
                      type="text" 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                </div>

                {/* Status */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Employee Status</label>
                  <div className="relative group">
                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-amber-600 transition-colors" size={18} />
                    <select 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-sm transition-all focus:bg-white appearance-none"
                      value={formData.status}
                      onChange={e => setFormData({...formData, status: e.target.value as any})}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2 text-opacity-50">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Email Address (Read Only)</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      disabled
                      type="email" 
                      className="w-full pl-11 pr-4 py-3 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 text-sm cursor-not-allowed"
                      value={formData.email}
                    />
                  </div>
                </div>

                {/* Role */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">System Role</label>
                  <div className="relative group">
                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-amber-600 transition-colors" size={18} />
                    <select 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-sm transition-all focus:bg-white appearance-none"
                      value={formData.role}
                      onChange={e => setFormData({...formData, role: e.target.value as any})}
                    >
                      <option value="user">Standard Employee</option>
                      <option value="teamlead">Team Lead</option>
                      <option value="admin">System Administrator</option>
                    </select>
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Phone Number</label>
                  <div className="relative group">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-amber-600 transition-colors" size={18} />
                    <input 
                      type="tel" 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.phone}
                      onChange={e => setFormData({...formData, phone: e.target.value})}
                    />
                  </div>
                </div>

                {/* Department */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Department</label>
                  <div className="relative group">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-amber-600 transition-colors" size={18} />
                    <select 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-sm transition-all focus:bg-white appearance-none"
                      value={formData.department}
                      onChange={e => setFormData({...formData, department: e.target.value})}
                    >
                      <option value="OPERATIONS">Operations</option>
                      <option value="SALES">Sales</option>
                      <option value="ENGINEERING">Engineering</option>
                      <option value="MARKETING">Marketing</option>
                      <option value="HR">Human Resources</option>
                    </select>
                  </div>
                </div>

                {/* Shift Timing */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Shift Timing</label>
                  <div className="relative group">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-amber-600 transition-colors" size={18} />
                    <input 
                      type="text" 
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-sm transition-all focus:bg-white"
                      value={formData.shiftTiming}
                      onChange={e => setFormData({...formData, shiftTiming: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100 flex gap-4">
                <Button 
                  type="button" 
                  variant="ghost" 
                  className="flex-1 rounded-lg h-11 font-semibold text-xs border border-gray-200 text-gray-700 hover:bg-gray-50"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  className="flex-[2] bg-amber-600 hover:bg-amber-700 border-none rounded-lg h-11 font-semibold text-xs text-white shadow-sm"
                  disabled={loading}
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving Changes...
                    </div>
                  ) : 'Update Profile'}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const DeleteConfirmationModal = ({ user, isOpen, onClose, token, onRefresh }: { user: UserType | null, isOpen: boolean, onClose: () => void, token: string | null, onRefresh: () => void }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!token || !user) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'DELETE',
        headers: { 
          Authorization: `Bearer ${token}` 
        }
      });
      
      const json = await res.json();
      if (res.ok) {
        onRefresh();
        onClose();
      } else {
        setError(json.error || 'Failed to delete employee');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative flex flex-col overflow-hidden"
          >
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} className="text-red-500" />
              </div>
              <h3 className="text-xl font-black text-gray-900 tracking-tight mb-2">Delete Employee?</h3>
              <p className="text-sm text-gray-500 px-4">
                Are you sure you want to delete <span className="font-black text-gray-900">{user?.name}</span>? This action can be undone by an administrator later via soft-delete recovery.
              </p>

              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl flex items-center justify-center gap-2">
                  <X size={14} />
                  {error}
                </div>
              )}

              <div className="mt-8 flex gap-3">
                <Button 
                  variant="ghost" 
                  className="flex-1 rounded-lg h-11 font-semibold text-xs border border-gray-200 text-gray-700 hover:bg-gray-50"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button 
                  variant="primary" 
                  className="flex-1 bg-rose-600 hover:bg-rose-700 border-none rounded-lg h-11 font-semibold text-xs text-white shadow-sm"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Deleting...
                    </div>
                  ) : 'Confirm Delete'}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const AuthContext = createContext<{
  user: UserType | null;
  token: string | null;
  login: (data: any) => void;
  logout: () => void;
} | null>(null);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, icon: Icon, type = 'button' }: any) => {
  const variants: any = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    accent: 'bg-emerald-600 text-white hover:bg-emerald-700',
    ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${variants[variant]} ${className}`}
    >
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-white rounded-xl border border-gray-100 shadow-sm ${className}`}>
    {children}
  </div>
);

const DatePicker = ({ value, onChange }: { value: string, onChange: (date: string) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date(value));
  
  useEffect(() => {
    if (value) {
      setCurrentMonth(new Date(value));
    }
  }, [value]);

  const daysInMonth = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const handleSelect = (date: Date) => {
    onChange(format(date, 'yyyy-MM-dd'));
    setIsOpen(false);
  };

  const selectedDate = new Date(value);

  return (
    <div className="relative">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white cursor-pointer hover:bg-gray-50 transition-colors min-w-[160px] h-full"
      >
        <Calendar size={18} className="text-indigo-500" />
        <span className="text-gray-900 font-bold text-sm">
          {value ? format(new Date(value), 'dd/MM/yyyy') : 'Select Date'}
        </span>
      </div>

      <AnimatePresence>
        {isOpen && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute top-full left-0 mt-2 z-50 bg-white border border-gray-100 shadow-2xl rounded-2xl p-4 w-[300px] sm:w-[320px]"
            >
              <div className="flex items-center justify-between mb-4 px-1">
                <button 
                  onClick={(e) => { e.stopPropagation(); setCurrentMonth(subMonths(currentMonth, 1)); }}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-indigo-600 transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest leading-none">
                  {format(currentMonth, 'MMMM yyyy')}
                </h4>
                <button 
                  onClick={(e) => { e.stopPropagation(); setCurrentMonth(addMonths(currentMonth, 1)); }}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-indigo-600 transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                  <div key={day} className="text-center text-[10px] font-black text-gray-300 uppercase py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {daysInMonth.map((day, idx) => {
                  const isSelected = isSameDay(day, selectedDate);
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isCurrentDay = isToday(day);

                  return (
                    <button
                      key={idx}
                      onClick={(e) => { e.stopPropagation(); handleSelect(day); }}
                      className={`
                        h-9 w-full rounded-lg flex items-center justify-center text-xs font-bold transition-all relative
                        ${!isCurrentMonth ? 'text-gray-200' : 'text-gray-700'}
                        ${isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 scale-105 z-10' : 'hover:bg-indigo-50 hover:text-indigo-600'}
                      `}
                    >
                      {format(day, 'd')}
                      {isCurrentDay && !isSelected && (
                        <div className="absolute bottom-1 w-1 h-1 bg-indigo-400 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-50 flex justify-center">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleSelect(new Date()); }}
                  className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
                >
                  Go to Today
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Pages ---

const landingFeatures: { icon: React.ElementType; label: string; desc: string }[] = [
  { icon: MapPin, label: 'GPS Verified', desc: 'Location-stamped punches' },
  { icon: Activity, label: 'Live Monitor', desc: 'Real-time employee status' },
  { icon: TrendingUp, label: 'Analytics', desc: 'Deep attendance insights' },
  { icon: ShieldCheck, label: 'Secure JWT', desc: 'Token-based auth & RBAC' },
];

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex flex-col">
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2.5 rounded-xl text-white shadow-lg shadow-indigo-200">
            <Briefcase size={22} />
          </div>
          <div>
            <h1 className="text-lg font-black text-gray-900 tracking-tight leading-none">TimeTracker Pro</h1>
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-widest mt-0.5">Workforce Management</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-gray-400 bg-white px-3 py-2 rounded-xl border border-gray-100 shadow-sm">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          System Operational
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center p-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-5xl"
        >
          {/* Badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest border border-indigo-100 shadow-sm">
              <Zap size={12} className="text-indigo-500" />
              Enterprise Attendance {'&'} Time Intelligence
            </div>
          </div>

          {/* Headline */}
          <div className="text-center mb-14">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-gray-900 tracking-tight leading-tight mb-5">
              Track Every Minute.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">
                Empower Every Team.
              </span>
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto leading-relaxed">
              Real-time attendance monitoring, GPS-verified punch events, and in-depth workforce analytics — all in one secure platform.
            </p>
          </div>

          {/* Portal Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto mb-16">
            <Link to="/login">
              <motion.div
                whileHover={{ scale: 1.02, y: -6 }}
                whileTap={{ scale: 0.98 }}
                className="bg-white rounded-3xl p-8 border-2 border-gray-100 hover:border-indigo-300 shadow-xl hover:shadow-2xl hover:shadow-indigo-100/60 transition-all cursor-pointer group"
              >
                <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-indigo-200 group-hover:scale-110 transition-transform">
                  <User size={28} className="text-white" />
                </div>
                <h3 className="text-xl font-black text-gray-900 mb-2 tracking-tight">Employee Portal</h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-6">
                  Punch in/out with GPS verification, manage your breaks, track daily hours and submit work reports.
                </p>
                <div className="flex items-center gap-1.5 text-indigo-600 font-black text-sm group-hover:gap-3 transition-all">
                  Access Portal <ChevronRight size={18} />
                </div>
              </motion.div>
            </Link>

            <Link to="/admin/login">
              <motion.div
                whileHover={{ scale: 1.02, y: -6 }}
                whileTap={{ scale: 0.98 }}
                className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl p-8 border-2 border-indigo-600 shadow-xl hover:shadow-2xl hover:shadow-indigo-300/50 transition-all cursor-pointer group"
              >
                <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform border border-white/20">
                  <ShieldCheck size={28} className="text-white" />
                </div>
                <h3 className="text-xl font-black text-white mb-2 tracking-tight">Admin Control Center</h3>
                <p className="text-sm text-indigo-200 leading-relaxed mb-6">
                  Oversee your entire workforce — live attendance, employee management, and deep analytics from one dashboard.
                </p>
                <div className="flex items-center gap-1.5 text-white font-black text-sm group-hover:gap-3 transition-all">
                  Admin Access <ChevronRight size={18} />
                </div>
              </motion.div>
            </Link>
          </div>

          {/* Feature Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {landingFeatures.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="bg-white/70 backdrop-blur-sm rounded-2xl p-4 text-center border border-gray-100 shadow-sm hover:shadow-md transition-all">
                <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-center mx-auto mb-3 text-indigo-600">
                  <Icon size={20} />
                </div>
                <p className="text-sm font-black text-gray-900 tracking-tight">{label}</p>
                <p className="text-[11px] text-gray-400 mt-1 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="py-5 px-6 flex items-center justify-between max-w-7xl mx-auto w-full border-t border-gray-100">
        <p className="text-xs text-gray-400 font-medium">
          © {new Date().getFullYear()} TimeTracker Pro. All rights reserved.
        </p>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-300">v2.0</span>
        </div>
      </footer>
    </div>
  );
};

const LoginPage = ({ isAdmin = false }: { isAdmin?: boolean }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate(user.role === 'admin' ? '/admin' : user.role === 'teamlead' ? '/teamlead' : '/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      
      if (isAdmin && data.user.role !== 'admin') {
        throw new Error('Access denied. Admin credentials required.');
      }
      
      login(data);
      const dest = data.user.role === 'admin' ? '/admin' : data.user.role === 'teamlead' ? '/teamlead' : '/dashboard';
      navigate(dest, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 text-left">
           <Link to="/" className="inline-flex items-center gap-1 text-gray-400 hover:text-indigo-600 transition-colors text-sm font-medium">
             <ChevronLeft size={16} />
             Back to Selection
           </Link>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {isAdmin ? 'Admin Portal' : 'Time Tracker'}
          </h1>
          <p className="text-gray-500 mt-1">
            {isAdmin ? 'Manage your workforce' : 'Sign in to your account'}
          </p>
        </div>

        <Card className="p-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                id="login-email"
                type="email"
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="w-full px-4 py-2 pr-11 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            
            {error && <p className="text-sm text-red-600">{error}</p>}
            
            <Button disabled={loading} className="w-full h-11" type="submit">
              {loading ? 'Authenticating...' : 'Sign In'}
            </Button>
          </form>

          <p className="text-center mt-6 text-sm text-gray-500">
            Don't have an account?{' '}
            <Link 
              to="/register" 
              state={{ isAdmin }}
              className="text-indigo-600 font-semibold hover:underline"
            >
              Register
            </Link>
          </p>

          {isAdmin ? (
            <p className="text-center mt-6 text-sm text-gray-500">
              <Link to="/login" className="text-indigo-600 font-semibold hover:underline">
                Employee Login
              </Link>
            </p>
          ) : (
            <p className="text-center mt-4 text-xs text-gray-400">
              <Link to="/admin/login" className="hover:text-gray-600">
                Admin Access
              </Link>
            </p>
          )}
        </Card>
      </motion.div>
    </div>
  );
};

const RegisterPage = () => {
  const { login, user } = useAuth();
  const location = useLocation();
  const isAdminRequest = location.state?.isAdmin || false;
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    role: isAdminRequest ? 'admin' : 'user'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate(user.role === 'admin' ? '/admin' : user.role === 'teamlead' ? '/teamlead' : '/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      return setError('Passwords do not match');
    }
    
    setLoading(true);
    setError('');
    
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      
      // Auto-login after registration
      login(data);
      const dest = data.user.role === 'admin' ? '/admin' : data.user.role === 'teamlead' ? '/teamlead' : '/dashboard';
      navigate(dest, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 py-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 text-left">
           <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-gray-400 hover:text-indigo-600 transition-colors text-sm font-medium">
             <ChevronLeft size={16} />
             Back to Previous
           </button>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {formData.role === 'admin' ? 'Admin Registration' : 'Create Account'}
          </h1>
          <p className="text-gray-500 mt-1">Join Time Tracker system</p>
        </div>

        <Card className="p-8">
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                id="reg-name"
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                id="reg-email"
                type="email"
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input
                id="reg-phone"
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  id="reg-pass"
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="w-full px-4 py-2 pr-11 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  id="reg-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  className="w-full px-4 py-2 pr-11 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            
            {error && <p className="text-sm text-red-600">{error}</p>}
            
            <Button disabled={loading} className="w-full h-11" type="submit">
              {loading ? 'Creating...' : 'Register'}
            </Button>
          </form>

          <p className="text-center mt-6 text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-600 font-semibold hover:underline">
              Sign In
            </Link>
          </p>
        </Card>
      </motion.div>
    </div>
  );
};

// ── Notification Bell ─────────────────────────────────────────────────────────
type AppNotification = {
  id: string;
  type: 'overdue' | 'due_today' | 'due_soon' | 'auto_punchout_warning' | 'auto_punchout' | 'auto_punchout_warning_lead' | 'auto_punchout_summary';
  message: string;
  sub: string;
  taskId?: string;
  read: boolean;
};

const NotificationBell = () => {
  const { user, token } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('notif_read') || '[]')); }
    catch { return new Set(); }
  });
  const ref = React.useRef<HTMLDivElement>(null);

  const buildNotifications = (tasks: Task[], allUsers?: UserType[]) => {
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const in3days  = new Date(today); in3days.setDate(in3days.getDate() + 3);
    const notifs: AppNotification[] = [];

    const activeTasks = tasks.filter(t => t.status !== 'completed');

    if (user?.role === 'user') {
      // Employee sees their own task notifications
      for (const t of activeTasks) {
        if (!t.dueDate) continue;
        const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0);
        if (due < today) {
          notifs.push({ id: `overdue-${t.id}`, type: 'overdue', taskId: t.id,
            message: `Task overdue: "${t.title}"`,
            sub: `Was due ${format(due, 'MMM d')} · Assigned by ${t.assignedByName || 'Team Lead'}`,
            read: false });
        } else if (due.getTime() === today.getTime()) {
          notifs.push({ id: `today-${t.id}`, type: 'due_today', taskId: t.id,
            message: `Due today: "${t.title}"`,
            sub: `Complete before end of day · ${t.priority} priority`,
            read: false });
        } else if (due <= in3days) {
          notifs.push({ id: `soon-${t.id}`, type: 'due_soon', taskId: t.id,
            message: `Due soon: "${t.title}"`,
            sub: `Due ${format(due, 'MMM d')} · ${t.priority} priority`,
            read: false });
        }
      }
    } else {
      // Team lead / admin sees all incomplete team tasks
      for (const t of activeTasks) {
        const employeeName = allUsers?.find(u => u.id === t.assignedTo)?.name || 'An employee';
        if (!t.dueDate) continue;
        const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0);
        if (due < today) {
          notifs.push({ id: `overdue-${t.id}`, type: 'overdue', taskId: t.id,
            message: `${employeeName} — overdue task`,
            sub: `"${t.title}" · was due ${format(due, 'MMM d')}`,
            read: false });
        } else if (due.getTime() === today.getTime()) {
          notifs.push({ id: `today-${t.id}`, type: 'due_today', taskId: t.id,
            message: `${employeeName} — task due today`,
            sub: `"${t.title}" · ${t.priority} priority`,
            read: false });
        } else if (due <= in3days) {
          notifs.push({ id: `soon-${t.id}`, type: 'due_soon', taskId: t.id,
            message: `${employeeName} — task due soon`,
            sub: `"${t.title}" · due ${format(due, 'MMM d')}`,
            read: false });
        }
      }
    }
    return notifs.map(n => ({ ...n, read: readIds.has(n.id) }));
  };

  const fetchNotifications = async () => {
    if (!token) return;
    try {
      // Fetch system notifications (auto punch-out alerts)
      const sysRes = await apiFetch('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
      const sysNotifs: AppNotification[] = [];
      if (sysRes.ok) {
        const sysData = await sysRes.json();
        const typeLabels: Record<string, string> = {
          auto_punchout_warning:      'Punch-Out Warning',
          auto_punchout:              'Auto Punched Out',
          auto_punchout_warning_lead: 'Punch-Out Warning',
          auto_punchout_summary:      'Auto Punch-Out',
        };
        for (const n of sysData) {
          if (!typeLabels[n.type]) continue;
          sysNotifs.push({
            id:      `sys-${n.id}`,
            type:    n.type as AppNotification['type'],
            message: n.title,
            sub:     n.message,
            read:    n.isRead || readIds.has(`sys-${n.id}`),
          });
        }
      }

      if (user?.role === 'user') {
        const res = await apiFetch('/api/tasks', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { setNotifications(sysNotifs); return; }
        const tasks: Task[] = await res.json();
        setNotifications([...sysNotifs, ...buildNotifications(tasks)]);
      } else {
        const [taskRes, teamRes] = await Promise.all([
          apiFetch('/api/tasks',          { headers: { Authorization: `Bearer ${token}` } }),
          apiFetch('/api/teamlead/data',  { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (!taskRes.ok) { setNotifications(sysNotifs); return; }
        const tasks: Task[]        = await taskRes.json();
        const teamData             = teamRes.ok ? await teamRes.json() : {};
        const allUsers: UserType[] = Array.isArray(teamData.users) ? teamData.users : [];
        setNotifications([...sysNotifs, ...buildNotifications(tasks, allUsers)]);
      }
    } catch (_) {}
  };

  useEffect(() => { fetchNotifications(); }, [token, readIds]);

  // Poll every 60 s — use a ref so the interval always calls the latest version
  const fetchRef = React.useRef(fetchNotifications);
  useEffect(() => { fetchRef.current = fetchNotifications; });
  useEffect(() => {
    const t = setInterval(() => fetchRef.current(), 60_000);
    return () => clearInterval(t);
  }, [token]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unread = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    const newIds = new Set([...readIds, ...notifications.map(n => n.id)]);
    setReadIds(newIds);
    localStorage.setItem('notif_read', JSON.stringify([...newIds]));
    // Mark server-side system notifications read
    if (token) apiFetch('/api/notifications/read', { method: 'PUT', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  };

  const markRead = (id: string) => {
    const newIds = new Set([...readIds, id]);
    setReadIds(newIds);
    localStorage.setItem('notif_read', JSON.stringify([...newIds]));
  };

  const typeStyle: Record<string, { bg: string; border: string; dot: string; label: string; lbg: string }> = {
    overdue:                   { bg: 'bg-rose-50',   border: 'border-rose-200',   dot: 'bg-rose-500',   label: 'Overdue',      lbg: 'bg-rose-100 text-rose-700'    },
    due_today:                 { bg: 'bg-amber-50',  border: 'border-amber-200',  dot: 'bg-amber-500',  label: 'Due Today',    lbg: 'bg-amber-100 text-amber-700'  },
    due_soon:                  { bg: 'bg-blue-50',   border: 'border-blue-200',   dot: 'bg-blue-400',   label: 'Due Soon',     lbg: 'bg-blue-100 text-blue-700'    },
    auto_punchout_warning:     { bg: 'bg-amber-50',  border: 'border-amber-300',  dot: 'bg-amber-500',  label: 'Punch-Out',    lbg: 'bg-amber-100 text-amber-700'  },
    auto_punchout:             { bg: 'bg-indigo-50', border: 'border-indigo-200', dot: 'bg-indigo-500', label: 'Auto Logout',  lbg: 'bg-indigo-100 text-indigo-700'},
    auto_punchout_warning_lead:{ bg: 'bg-amber-50',  border: 'border-amber-300',  dot: 'bg-amber-500',  label: 'Team Alert',   lbg: 'bg-amber-100 text-amber-700'  },
    auto_punchout_summary:     { bg: 'bg-indigo-50', border: 'border-indigo-200', dot: 'bg-indigo-500', label: 'Auto Logout',  lbg: 'bg-indigo-100 text-indigo-700'},
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => !o); if (!open) fetchNotifications(); }}
        className="relative p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-all"
        title="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-rose-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1 animate-pulse">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-12 w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <div className="flex items-center gap-2">
                <Bell size={15} className="text-indigo-500" />
                <span className="text-sm font-black text-gray-800">Notifications</span>
                {unread > 0 && (
                  <span className="text-[10px] font-black bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full">{unread} new</span>
                )}
              </div>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-[10px] font-black text-indigo-500 hover:text-indigo-700 transition-colors">
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <CheckCircle size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-semibold">All caught up!</p>
                  <p className="text-xs mt-1">No pending task alerts</p>
                </div>
              ) : (
                notifications.map(n => {
                  const s = typeStyle[n.type];
                  return (
                    <div
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer transition-all hover:bg-gray-50 ${n.read ? 'opacity-60' : ''}`}
                    >
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.dot} ${n.read ? 'opacity-30' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className={`text-xs font-black text-gray-900 ${n.read ? 'font-semibold text-gray-500' : ''}`}>{n.message}</p>
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${s.lbg}`}>{s.label}</span>
                        </div>
                        <p className="text-[10px] text-gray-400 font-medium leading-relaxed">{n.sub}</p>
                      </div>
                      {!n.read && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0" />}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2.5 bg-gray-50/60 border-t border-gray-100 text-center">
                <p className="text-[10px] text-gray-400 font-semibold">
                  {notifications.filter(n => n.type === 'overdue').length} overdue ·{' '}
                  {notifications.filter(n => n.type === 'due_today').length} due today ·{' '}
                  {notifications.filter(n => ['auto_punchout_warning','auto_punchout','auto_punchout_warning_lead','auto_punchout_summary'].includes(n.type)).length} punch-out alerts
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DashboardLayout = ({ children, title, showBack = false }: { children: ReactNode, title: string, showBack?: boolean }) => {
  const { user, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { label: 'Dashboard', path: user?.role === 'admin' ? '/admin' : user?.role === 'teamlead' ? '/teamlead' : '/dashboard', icon: LayoutDashboard },
  ];

  if (user?.role === 'user') {
    navItems.push({ label: 'Reports', path: '/reports', icon: FileText });
  }

  if (user?.role === 'admin') {
    navItems.push({ label: 'Employees', path: '/admin/users', icon: User });
    navItems.push({ label: 'Monthly Report', path: '/admin/monthly', icon: FileText });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden h-16 bg-white border-b border-gray-100 flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          {showBack && (
            <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-gray-500 hover:text-indigo-600">
              <ChevronLeft size={24} />
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
              <Briefcase size={18} />
            </div>
            <span className="font-bold text-gray-900 tracking-tight">Time Tracker</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-gray-500 hover:bg-gray-50 rounded-lg">
            {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`w-64 bg-white border-r border-gray-100 flex flex-col fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-gray-100 hidden md:flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-indigo-100 shadow-lg">
            <Briefcase size={24} />
          </div>
          <span className="font-bold text-gray-900 tracking-tight text-xl">Time Tracker</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 mt-4">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.path} 
              onClick={() => setIsSidebarOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${location.pathname === item.path ? 'text-indigo-600 bg-indigo-50 shadow-sm' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
            >
              <item.icon size={20} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100 space-y-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold border-2 border-white shadow-sm">
              {user?.name.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider transition-colors">{user?.role}</p>
            </div>
          </div>
          <Button variant="ghost" className="w-full justify-start text-red-600 hover:bg-red-50 py-3 rounded-xl border border-transparent hover:border-red-100" onClick={logout}>
              <LogOut size={20} />
              Sign Out
          </Button>
        </div>
      </aside>

      {/* Backdrop for mobile */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Desktop Header */}
        <header className="h-16 bg-white border-b border-gray-100 px-6 hidden md:flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4">
            {showBack && (
              <button 
                onClick={() => navigate(-1)} 
                className="p-2 -ml-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                title="Go Back"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-500 font-semibold bg-gray-50 px-4 py-2 rounded-xl">
               <Calendar size={16} className="text-indigo-600" />
               {format(new Date(), 'EEEE, MMMM do')}
            </div>
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto pb-12">
             {children}
          </div>
        </main>
      </div>
    </div>
  );
};

// ── Break label helpers ───────────────────────────────────────────────
const LOG_LABELS: Record<string, string> = {
  login:       'Punch In',
  logout:      'Punch Out',
  lunch_in:    'Lunch Start',
  lunch_out:   'Lunch End',
  break_start: 'Break Start',
  break_end:   'Break End',
  daily_report:'Daily Report',
  idle_start:  'System Idle / Screen Off',
  idle_end:    'Activity Resumed',
};

const LOG_COLORS: Record<string, string> = {
  login:       'bg-emerald-500 ring-emerald-400',
  logout:      'bg-rose-500 ring-rose-400',
  lunch_in:    'bg-amber-400 ring-amber-300',
  lunch_out:   'bg-amber-400 ring-amber-300',
  break_start: 'bg-sky-400 ring-sky-300',
  break_end:   'bg-sky-400 ring-sky-300',
  daily_report:'bg-indigo-400 ring-indigo-300',
  idle_start:  'bg-orange-400 ring-orange-300',
  idle_end:    'bg-teal-400 ring-teal-300',
};

// ── Submit Answer Box (employee answers a task) ───────────────────────────────
const SubmitAnswerBox = ({ taskId, token, onSubmitted }: { taskId: string; token: string | null; onSubmitted: () => void }) => {
  const [answer, setAnswer] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const submit = async () => {
    if (!answer.trim()) { setError('Please write your answer before submitting'); return; }
    setLoading(true); setError('');
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ submission: answer }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Failed'); }
      setSubmitted(true);
      onSubmitted();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (submitted) return (
    <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
      <p className="text-xs font-black text-emerald-600">✅ Answer submitted successfully!</p>
    </div>
  );

  return (
    <div className="mt-3 bg-gray-50 border-2 border-indigo-100 rounded-xl p-3 space-y-2">
      <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1.5">
        <FileText size={11} /> Post Your Answer / Solution
      </p>
      <textarea
        rows={5}
        placeholder={"Type or paste your answer here...\n\nExample:\nfunction solution() {\n  // your code\n}"}
        className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-[12px] font-mono text-green-300 placeholder-gray-600 outline-none focus:ring-2 focus:ring-indigo-500 resize-y leading-relaxed"
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const s = el.selectionStart;
            const newVal = el.value.substring(0, s) + '  ' + el.value.substring(el.selectionEnd);
            setAnswer(newVal);
            setTimeout(() => { el.selectionStart = el.selectionEnd = s + 2; }, 0);
          }
        }}
      />
      {error && <p className="text-[11px] text-red-500 font-bold">{error}</p>}
      <button
        onClick={submit}
        disabled={loading || !answer.trim()}
        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {loading ? 'Submitting...' : '✅ Submit Answer to Team Lead'}
      </button>
    </div>
  );
};

const UserDashboard = () => {
  const { user, token } = useAuth();
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [isIdleWarning, setIsIdleWarning] = useState(false);  // show warning on employee screen
  const [locationError, setLocationError] = useState<string | null>(null); // location permission error
  // Ref to track optimistic action — prevents fetchLogs from overwriting it too early
  const pendingActionRef = React.useRef<string | null>(null);
  // Ref to prevent duplicate submissions within 3 seconds
  const lastSubmitTimeRef = React.useRef<Record<string, number>>({});
  // Ref so idle detection always reads latest lastAction without stale closure
  const lastActionRef = React.useRef<string | null>(null);

  // Real-time clock — ticks every second so Active Hours stays live
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchLogs = async (autoFixIdle = false) => {
    try {
      const res = await apiFetch('/api/logs', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const logs = Array.isArray(data) ? data : [];
      setLogs(logs);

      // Auto-fix stale idle_start: if the most recent idle_start has no idle_end after it,
      // the system is clearly ON now (we're running this code), so send idle_end to clear it.
      if (autoFixIdle) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayLogs = logs.filter((l: TimeLog) => l.timestamp.startsWith(todayStr));
        const sorted = [...todayLogs].sort((a: TimeLog, b: TimeLog) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        const lastIdleStart = [...sorted].reverse().find((l: TimeLog) => l.type === 'idle_start');
        const lastIdleEnd   = [...sorted].reverse().find((l: TimeLog) => l.type === 'idle_end');
        const hasStaleIdle  = lastIdleStart && (
          !lastIdleEnd ||
          new Date(lastIdleEnd.timestamp) < new Date(lastIdleStart.timestamp)
        );
        if (hasStaleIdle) {
          // System is ON right now — clear the stale idle_start automatically
          await apiFetch('/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ type: 'idle_end', note: 'Auto-cleared: system is active' }),
          });
          setIsIdleWarning(false);
          // Re-fetch to get the updated logs
          const res2 = await apiFetch('/api/logs', { headers: { Authorization: `Bearer ${token}` } });
          if (res2.ok) {
            const data2 = await res2.json();
            setLogs(Array.isArray(data2) ? data2 : []);
          }
          return;
        }
      }

      // Only derive lastAction from TODAY's logs — yesterday's state must not affect today
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayOnly = logs.filter((l: TimeLog) => l.timestamp.startsWith(todayStr));
      const lastPunchLog = [...todayOnly].reverse().find((l: TimeLog) =>
        !['daily_report','idle_start','idle_end','location_update'].includes(l.type)
      );
      if (!pendingActionRef.current) {
        // No pending action — set from server data
        setLastAction(lastPunchLog?.type ?? null);
      } else if (pendingActionRef.current === lastPunchLog?.type) {
        // Server confirmed the pending action
        setLastAction(lastPunchLog.type);
        pendingActionRef.current = null;
      }
      // else: pending action not confirmed yet — keep optimistic state
    } catch (err) { console.error(err); }
  };

  const fetchTasks = async () => {
    try {
      const res = await apiFetch('/api/tasks', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    fetchLogs(true);
    fetchTasks();
    // Auto-refresh every 30s — keeps hours live and clears stale idle after system wakes
    const interval = setInterval(() => { fetchLogs(false); fetchTasks(); }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Sleep / screen-lock detection (system-level only) ───────────────
  // Uses heartbeat gap: if setInterval fires 15+ min late → system was asleep/locked.
  // Does NOT use mouse/keyboard (those are browser-only, employee may work in other apps).
  // 15 min sleep → warn employee + notify team lead
  // 20 min sleep → time is deducted from working hours
  useEffect(() => {
    const NOTIFY_GAP_MS = 30 * 60 * 1000; // 30 min sleep gap → warn
    const DEDUCT_GAP_MS = 30 * 60 * 1000; // 30 min sleep gap → deduct
    let lastTick = Date.now();
    let idleSent = false;
    let idleStartedAt: number | null = null;

    const isActivelyWorking = () => {
      const a = lastActionRef.current;
      return a === 'login' || a === 'break_end' || a === 'lunch_out';
    };

    const postIdleEvent = async (type: 'idle_start' | 'idle_end', note?: string) => {
      try {
        await apiFetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ type, note }),
        });
        fetchLogs();
      } catch (_) {}
    };

    const triggerSleepIdle = (gapMs: number) => {
      if (idleSent || !isActivelyWorking()) return;
      idleSent = true;
      // Back-date idle_start to when the system actually went to sleep
      idleStartedAt = Date.now() - gapMs;
      setIsIdleWarning(true);
      const gapMins = Math.round(gapMs / 60000);
      postIdleEvent('idle_start', `System was asleep / screen locked for ${gapMins} minutes`);
    };

    const resumeFromSleep = () => {
      if (!idleSent) return;
      idleSent = false;
      setIsIdleWarning(false);
      const idleMs = idleStartedAt ? Date.now() - idleStartedAt : 0;
      const idleMinutes = Math.round(idleMs / 60000);
      const deducted = idleMs >= DEDUCT_GAP_MS;
      const note = deducted
        ? `System resumed after ${idleMinutes} min sleep — ${idleMinutes} min deducted from working hours`
        : `System resumed after ${idleMinutes} min (under 20 min, no deduction)`;
      idleStartedAt = null;
      postIdleEvent('idle_end', note);
    };

    // Heartbeat: fires every 30 seconds. If it fires late by ≥15 min,
    // the system was asleep or the screen was locked.
    const sleepWatcher = setInterval(() => {
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;

      if (!isActivelyWorking()) {
        // Employee not working — clear any stale idle state
        if (idleSent) resumeFromSleep();
        return;
      }

      if (gap >= NOTIFY_GAP_MS) {
        // System was asleep/locked for 15+ min
        triggerSleepIdle(gap);
      } else if (idleSent) {
        // System is back and was previously idle — resume
        resumeFromSleep();
      }
    }, 30_000); // check every 30 seconds

    return () => {
      clearInterval(sleepWatcher);
    };
  }, [token]);

  // ── Continuous location tracking (every 5 minutes while logged in) ───
  useEffect(() => {
    const LOCATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    const sendLocation = () => {
      // Only track if employee is actively working (not on break/lunch/logged out)
      const isActivelyWorking = lastAction === 'login' || lastAction === 'break_end' || lastAction === 'lunch_out';
      if (!isActivelyWorking || !token) return;

      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(
        pos => {
          apiFetch('/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              type: 'location_update',
              location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
              note: 'Auto location update',
            }),
          }).catch(() => {});
        },
        () => {}, // silently ignore geolocation errors
        { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true }
      );
    };

    const interval = setInterval(sendLocation, LOCATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, lastAction]);

  const submitPunchEvent = async (type: string, location: { lat: number; lng: number } | null) => {
    try {
      const res = await apiFetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, location, note }),
      });
      if (res.ok) { setNote(''); fetchLogs(); }
      else { pendingActionRef.current = null; } // clear on failure
    } catch (err) { console.error('Punch event failed:', err); pendingActionRef.current = null; }
    finally { setLoading(false); }
  };

  const handleAction = (type: string) => {
    // Prevent duplicate submissions of the same type within 3 seconds
    const now = Date.now();
    const lastTime = lastSubmitTimeRef.current[type] ?? 0;
    if (now - lastTime < 3000) return;
    lastSubmitTimeRef.current[type] = now;

    setLocationError(null);

    // Location is MANDATORY for punch-in (login)
    if (type === 'login') {
      if (!navigator.geolocation) {
        setLocationError('Your device does not support GPS. Please use a device with location support to punch in.');
        return;
      }
      setLoading(true);
      pendingActionRef.current = type;
      navigator.geolocation.getCurrentPosition(
        pos => {
          setLastAction(type); // optimistic update only after location confirmed
          submitPunchEvent(type, { lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        err => {
          setLoading(false);
          pendingActionRef.current = null;
          if (err.code === 1) {
            setLocationError('📍 Location permission denied. Please allow location access in your browser settings to punch in.');
          } else if (err.code === 2) {
            setLocationError('📍 Location unavailable. Make sure GPS is enabled on your device.');
          } else {
            setLocationError('📍 Location request timed out. Please try again.');
          }
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
      );
      return;
    }

    // For all other actions, location is captured but not mandatory
    setLoading(true);
    pendingActionRef.current = type;
    setLastAction(type); // optimistic update
    if (!navigator.geolocation) { submitPunchEvent(type, null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => submitPunchEvent(type, { lat: pos.coords.latitude, lng: pos.coords.longitude }),
      _err => submitPunchEvent(type, null), // non-login: proceed without location
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true }
    );
  };

  const updateTaskStatus = async (id: string, status: string) => {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    fetchTasks();
  };

  // Keep ref in sync so idle detection always has latest punch state
  lastActionRef.current = lastAction;
  const isWorking   = lastAction === 'login' || lastAction === 'break_end' || lastAction === 'lunch_out';
  const isOnBreak   = lastAction === 'break_start';
  const isOnLunch   = lastAction === 'lunch_in';
  const isLoggedOut = lastAction === 'logout';

  const getStatus = () => {
    if (isWorking)   return 'Working';
    if (isOnBreak)   return 'On Break';
    if (isOnLunch)   return 'On Lunch Break';
    if (lastAction === 'lunch_out') return 'Back from Lunch';
    if (isLoggedOut) return 'Shift Completed';
    return 'Not Started';
  };

  const activeBreakWindow = getActiveBreakWindow(currentTime);

  // Today's logs only
  const todayLogs = logs.filter(l =>
    isWithinInterval(new Date(l.timestamp), { start: startOfDay(currentTime), end: endOfDay(currentTime) })
  );
  const { hours: activeH, minutes: activeM, totalMinutes: activeMins, idleDeductedMinutes } = calculateTotalHours(todayLogs);
  const progressPct = Math.min(100, (activeMins / (WORK_SCHEDULE.requiredHours * 60)) * 100);
  const firstPunch  = todayLogs.find(l => l.type === 'login');

  // Break / lunch timer variables (computed once, used in render)
  const breakLog = (isOnBreak || isOnLunch)
    ? [...todayLogs]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .find(l => l.type === (isOnBreak ? 'break_start' : 'lunch_in')) ?? null
    : null;
  const bAllowedMins  = isOnLunch ? 30 : 15;
  const bElapsedSecs  = breakLog ? Math.floor((currentTime.getTime() - new Date(breakLog.timestamp).getTime()) / 1000) : 0;
  const bRemainSecs   = Math.max(0, bAllowedMins * 60 - bElapsedSecs);
  const bOverSecs     = Math.max(0, bElapsedSecs - bAllowedMins * 60);
  const bIsOver       = bElapsedSecs >= bAllowedMins * 60;
  const bPct          = Math.min(100, (bElapsedSecs / (bAllowedMins * 60)) * 100);
  const bPad = (n: number) => String(n).padStart(2, '0');
  const bElapsedStr   = `${bPad(Math.floor(bElapsedSecs / 60))}:${bPad(bElapsedSecs % 60)}`;
  const bRemainStr    = `${bPad(Math.floor(bRemainSecs / 60))}:${bPad(bRemainSecs % 60)}`;
  const bOverStr      = `+${bPad(Math.floor(bOverSecs / 60))}:${bPad(bOverSecs % 60)}`;

  // Break button state helpers
  const morningBreakDone = todayLogs.some(l => l.type === 'break_end');
  const lunchDone        = todayLogs.some(l => l.type === 'lunch_out');
  const breakEndCount    = todayLogs.filter(l => l.type === 'break_end').length;
  const eveningBreakDone = breakEndCount >= 2;

  const statusColorRing = isWorking || lastAction === 'lunch_out'
    ? 'bg-emerald-500 shadow-emerald-100 ring-emerald-50'
    : isOnBreak || isOnLunch
    ? 'bg-amber-400 shadow-amber-100 ring-amber-50'
    : isLoggedOut
    ? 'bg-gray-300 shadow-gray-100 ring-gray-50'
    : 'bg-gray-400 shadow-gray-100 ring-gray-50';

  const PRIORITY_CONF: Record<string, { bg: string; text: string; dot: string }> = {
    urgent:  { bg: 'bg-rose-50',   text: 'text-rose-700',   dot: 'bg-rose-500'   },
    high:    { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
    medium:  { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-400'  },
    low:     { bg: 'bg-sky-50',    text: 'text-sky-700',    dot: 'bg-sky-400'    },
  };

  const TASK_STATUS_CONF: Record<string, { icon: React.ElementType; label: string; cls: string }> = {
    pending:     { icon: Circle,      label: 'Pending',     cls: 'text-gray-500'    },
    in_progress: { icon: PlayCircle,  label: 'In Progress', cls: 'text-indigo-600'  },
    completed:   { icon: CheckSquare, label: 'Completed',   cls: 'text-emerald-600' },
    overdue:     { icon: AlertCircle, label: 'Overdue',     cls: 'text-rose-600'    },
  };

  return (
    <DashboardLayout title="Employee Portal">
      {/* ── Auto Punch-Out Warning Banner (6:30–6:40 PM) ─────────────────── */}
      {(() => {
        const h = currentTime.getHours();
        const m = currentTime.getMinutes();
        const minsLeft = 40 - m;
        const showWarning = h === 18 && m >= 30 && m < 40 && (lastAction === 'login' || lastAction === 'break_end' || lastAction === 'lunch_out');
        return showWarning ? (
          <div className="mb-4 bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shrink-0 animate-pulse">
              <Clock size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-amber-700">
                ⚠️ Auto Punch-Out in {minsLeft} minute{minsLeft !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-amber-600 font-semibold mt-1">
                You will be <strong>automatically punched out at 6:40 PM</strong>. Please save your work and punch out manually if you're done.
              </p>
            </div>
          </div>
        ) : null;
      })()}

      {/* ── Idle Warning Banner ─────────────────────────────────────────── */}
      {isIdleWarning && (
        <div className="mb-4 bg-orange-50 border-2 border-orange-300 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shrink-0 animate-pulse">
            <Monitor size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-black text-orange-700">⚠️ System idle — time tracking paused</p>
            <p className="text-xs text-orange-600 font-semibold mt-1">Your system has been idle for <strong>15+ minutes</strong>. Your team lead has been notified.</p>
            <p className="text-xs text-orange-500 mt-0.5">If idle exceeds <strong>20 minutes</strong>, that time will be <strong>automatically deducted</strong> from your working hours.</p>
            <p className="text-[10px] text-orange-400 mt-1 font-semibold">👆 Move your mouse or press any key to resume tracking</p>
          </div>
          <button onClick={() => setIsIdleWarning(false)} className="text-orange-400 hover:text-orange-600 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── Left column ────────────────────────────────────────────── */}
        <div className="lg:col-span-8 space-y-6">

          {/* Clock & Status */}
          <Card className="p-6 md:p-8">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Avatar ring */}
              <div className={`w-24 h-24 shrink-0 rounded-full flex items-center justify-center text-white ${statusColorRing} shadow-xl ring-8 transition-all duration-500`}>
                <Briefcase size={40} />
              </div>
              <div className="flex-1 text-center sm:text-left">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">
                  {format(currentTime, 'EEEE, MMMM do yyyy')}
                </p>
                <h3 className="text-5xl font-black text-gray-900 tracking-tight tabular-nums leading-none">
                  {format(currentTime, 'hh:mm:ss a')}
                </h3>
                <div className="mt-3 flex items-center justify-center sm:justify-start gap-2">
                  <div className={`w-2 h-2 rounded-full ${isWorking || lastAction === 'lunch_out' ? 'bg-emerald-500 animate-pulse' : isOnBreak || isOnLunch ? 'bg-amber-400 animate-pulse' : 'bg-gray-400'}`} />
                  <span className="text-sm font-bold text-gray-600">
                    Status: <span className="text-indigo-600">{getStatus()}</span>
                  </span>
                </div>


                {/* 8-hour progress bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                    <span>Work Progress</span>
                    <span>{activeH}h {activeM}m / {WORK_SCHEDULE.requiredHours}h required</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${progressPct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Today summary pills */}
              <div className="flex sm:flex-col gap-3 shrink-0">
                <div className="text-center bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3 min-w-[80px]">
                  <p className="text-xl font-black text-indigo-700 tabular-nums">{activeH}h {activeM}m</p>
                  <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mt-0.5">Active</p>
                  {idleDeductedMinutes > 0 && (
                    <p className="text-[8px] font-bold text-orange-500 mt-0.5">-{idleDeductedMinutes}m idle</p>
                  )}
                </div>
                <div className="text-center bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 min-w-[80px]">
                  <p className="text-xl font-black text-gray-800 tabular-nums">{firstPunch ? format(new Date(firstPunch.timestamp), 'h:mm a') : '--:--'}</p>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-0.5">Punch In</p>
                </div>
              </div>
            </div>
          </Card>

          {/* ── Punch Controls ─────────────────────────────────────── */}
          <Card className="p-6">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-5 flex items-center gap-2">
              <Timer size={14} className="text-indigo-500" />
              Attendance Actions
            </h4>

            {/* Optional note */}
            <div className="relative mb-5">
              <MessageSquare className="absolute left-4 top-3.5 text-gray-400" size={15} />
              <input
                type="text"
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all focus:bg-white placeholder-gray-400"
                placeholder="Optional note for this punch event…"
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Location error banner */}
            {locationError && (
              <div className="mb-4 bg-red-50 border-2 border-red-300 rounded-2xl p-4 flex items-start gap-3">
                <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center shrink-0">
                  <MapPin size={18} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-black text-red-700">Location Required to Punch In</p>
                  <p className="text-xs text-red-600 mt-1">{locationError}</p>
                  <p className="text-[10px] text-red-400 mt-1 font-semibold">
                    Click the 🔒 lock icon in your browser's address bar → Allow Location → then try again.
                  </p>
                </div>
                <button onClick={() => setLocationError(null)} className="text-red-400 hover:text-red-600 shrink-0">
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Main punch row */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => handleAction('login')}
                disabled={loading || isWorking || isOnLunch || (lastAction === 'lunch_out') || isLoggedOut}
                className={`flex flex-col items-center justify-center gap-2 h-24 rounded-2xl font-black text-sm transition-all
                  ${!loading && !isWorking && !isOnLunch && lastAction !== 'lunch_out' && !isLoggedOut
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-indigo-300'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
              >
                <LogIn size={22} />
                Punch In
                <span className="text-[10px] font-bold opacity-70">{WORK_SCHEDULE.loginTime.label}</span>
              </button>
              <button
                onClick={() => setShowFinishModal(true)}
                disabled={loading || isLoggedOut || (!isWorking && lastAction !== 'lunch_out')}
                className={`flex flex-col items-center justify-center gap-2 h-24 rounded-2xl font-black text-sm transition-all
                  ${!loading && !isLoggedOut && (isWorking || lastAction === 'lunch_out')
                    ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200 hover:from-emerald-600 hover:to-teal-700'
                    : isLoggedOut
                    ? 'bg-emerald-50 text-emerald-600 border-2 border-emerald-200 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
              >
                {isLoggedOut ? <CheckCircle size={22} /> : <CheckSquare size={22} />}
                {isLoggedOut ? 'Day Finished' : 'Finish Day'}
                <span className="text-[10px] font-bold opacity-70">{isLoggedOut ? '✓ Completed' : WORK_SCHEDULE.logoutTime.label}</span>
              </button>
            </div>

            {/* ── Break section ────────────────────────────────── */}
            {(isOnBreak || isOnLunch) ? (
              /* Active break/lunch panel */
              <div className={`mt-4 rounded-3xl border-2 overflow-hidden ${bIsOver ? 'bg-rose-50 border-rose-300' : isOnLunch ? 'bg-amber-50 border-amber-300' : 'bg-sky-50 border-sky-300'}`}>
                {/* Header */}
                <div className={`px-5 py-3 flex items-center justify-between ${bIsOver ? 'bg-rose-100' : isOnLunch ? 'bg-amber-100' : 'bg-sky-100'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{isOnLunch ? '🍽️' : '☕'}</span>
                    <div>
                      <p className={`text-sm font-black ${bIsOver ? 'text-rose-700' : isOnLunch ? 'text-amber-800' : 'text-sky-800'}`}>
                        {bIsOver ? `⚠️ ${isOnLunch ? 'Lunch' : 'Break'} Overtime!` : `${isOnLunch ? 'Lunch Break' : 'Break'} in Progress`}
                      </p>
                      <p className={`text-[10px] font-bold ${bIsOver ? 'text-rose-500' : isOnLunch ? 'text-amber-600' : 'text-sky-600'}`}>
                        {bAllowedMins} min allowed · started {breakLog ? format(new Date(breakLog.timestamp), 'h:mm a') : ''}
                      </p>
                    </div>
                  </div>
                  <span className={`text-3xl font-black tabular-nums ${bIsOver ? 'text-rose-600 animate-pulse' : isOnLunch ? 'text-amber-700' : 'text-sky-700'}`}>
                    {bIsOver ? bOverStr : bRemainStr}
                  </span>
                </div>

                {/* Progress bar */}
                <div className={`h-2.5 ${bIsOver ? 'bg-rose-200' : isOnLunch ? 'bg-amber-200' : 'bg-sky-200'}`}>
                  <div className={`h-full transition-all duration-1000 ${bIsOver ? 'bg-rose-500' : isOnLunch ? 'bg-amber-500' : 'bg-sky-500'}`}
                    style={{ width: bIsOver ? '100%' : `${bPct}%` }} />
                </div>

                {/* Stats row */}
                <div className="px-5 py-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className={`text-xl font-black tabular-nums ${bIsOver ? 'text-rose-600' : isOnLunch ? 'text-amber-700' : 'text-sky-700'}`}>{bElapsedStr}</p>
                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-wider mt-0.5">Elapsed</p>
                  </div>
                  <div>
                    <p className="text-xl font-black tabular-nums text-gray-700">{bPad(bAllowedMins)}:00</p>
                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-wider mt-0.5">Allowed</p>
                  </div>
                  <div>
                    <p className={`text-xl font-black tabular-nums ${bIsOver ? 'text-rose-600' : 'text-emerald-600'}`}>{bIsOver ? bOverStr : bRemainStr}</p>
                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-wider mt-0.5">{bIsOver ? 'Overtime' : 'Remaining'}</p>
                  </div>
                </div>

                {/* Finish button */}
                <div className="px-5 pb-5">
                  <button
                    onClick={() => handleAction(isOnBreak ? 'break_end' : 'lunch_out')}
                    disabled={loading}
                    className={`w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-3 text-white shadow-lg transition-all active:scale-95
                      ${bIsOver ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-200' : isOnLunch ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-sky-500 hover:bg-sky-600 shadow-sky-200'}`}
                  >
                    <CheckCircle size={22} />
                    {isOnLunch ? 'Finish Lunch · Resume Work' : 'Finish Break · Resume Work'}
                    {bIsOver && <span className="text-xs font-bold opacity-80 ml-1">(overdue)</span>}
                  </button>
                </div>
              </div>
            ) : (
              /* Normal mode: break start buttons */
              <div className="border-t border-dashed border-gray-200 pt-4">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Pause size={12} />
                  Scheduled Breaks — click to start
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {/* Morning Break */}
                  <button
                    onClick={() => handleAction('break_start')}
                    disabled={loading || !isWorking || morningBreakDone}
                    className={`flex flex-col items-center justify-center gap-1.5 h-20 rounded-2xl text-xs font-black transition-all border-2
                      ${morningBreakDone
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : activeBreakWindow === 'morning' && isWorking
                        ? 'bg-sky-50 border-sky-400 text-sky-700 shadow-md ring-2 ring-sky-200 animate-pulse'
                        : isWorking
                        ? 'bg-white border-gray-200 text-gray-600 hover:border-sky-300 hover:text-sky-600'
                        : 'bg-gray-50 border-gray-100 text-gray-300'}`}
                  >
                    <Sun size={18} />
                    {morningBreakDone ? '✓ Done' : 'Morning Break'}
                    <span className="text-[9px] opacity-70">{WORK_SCHEDULE.morningBreak.label} · 15m</span>
                  </button>

                  {/* Lunch Break */}
                  <button
                    onClick={() => handleAction('lunch_in')}
                    disabled={loading || !isWorking || lunchDone}
                    className={`flex flex-col items-center justify-center gap-1.5 h-20 rounded-2xl text-xs font-black transition-all border-2
                      ${lunchDone
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : activeBreakWindow === 'lunch' && isWorking
                        ? 'bg-amber-50 border-amber-400 text-amber-700 shadow-md ring-2 ring-amber-200 animate-pulse'
                        : isWorking
                        ? 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
                        : 'bg-gray-50 border-gray-100 text-gray-300'}`}
                  >
                    <Coffee size={18} />
                    {lunchDone ? '✓ Done' : 'Lunch Break'}
                    <span className="text-[9px] opacity-70">{WORK_SCHEDULE.lunchBreak.label} · 30m</span>
                  </button>

                  {/* Evening Break */}
                  <button
                    onClick={() => handleAction('break_start')}
                    disabled={loading || !isWorking || eveningBreakDone}
                    className={`flex flex-col items-center justify-center gap-1.5 h-20 rounded-2xl text-xs font-black transition-all border-2
                      ${eveningBreakDone
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : activeBreakWindow === 'evening' && isWorking
                        ? 'bg-violet-50 border-violet-400 text-violet-700 shadow-md ring-2 ring-violet-200 animate-pulse'
                        : isWorking
                        ? 'bg-white border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-600'
                        : 'bg-gray-50 border-gray-100 text-gray-300'}`}
                  >
                    <Sunset size={18} />
                    {eveningBreakDone ? '✓ Done' : 'Evening Break'}
                    <span className="text-[9px] opacity-70">{WORK_SCHEDULE.eveningBreak.label} · 15m</span>
                  </button>
                </div>

                {activeBreakWindow && isWorking && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className="mt-3 flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 text-xs text-indigo-700 font-semibold">
                    <Bell size={13} className="text-indigo-500 shrink-0" />
                    {activeBreakWindow === 'morning' && `Time for morning break: ${WORK_SCHEDULE.morningBreak.label} (15 min)`}
                    {activeBreakWindow === 'lunch'   && `Lunch time: ${WORK_SCHEDULE.lunchBreak.label} (30 min)`}
                    {activeBreakWindow === 'evening' && `Evening break: ${WORK_SCHEDULE.eveningBreak.label} (15 min)`}
                  </motion.div>
                )}
              </div>
            )}
          </Card>

          {/* ── Work Schedule Reference ─────────────────────────────── */}
          <Card className="p-6">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-5 flex items-center gap-2">
              <Clock size={14} className="text-indigo-500" />
              Today's Work Schedule
            </h4>
            <div className="flex flex-col gap-0">
              {[
                { time: WORK_SCHEDULE.loginTime.label,            label: 'Login',          color: 'bg-emerald-500', textColor: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-100' },
                { time: WORK_SCHEDULE.morningBreak.label,         label: 'Morning Break',  color: 'bg-sky-400',     textColor: 'text-sky-700',     bgColor: 'bg-sky-50 border-sky-100',     dur: '15 min' },
                { time: WORK_SCHEDULE.lunchBreak.label,           label: 'Lunch Break',    color: 'bg-amber-400',   textColor: 'text-amber-700',   bgColor: 'bg-amber-50 border-amber-100', dur: '30 min' },
                { time: WORK_SCHEDULE.eveningBreak.label,         label: 'Evening Break',  color: 'bg-violet-400',  textColor: 'text-violet-700',  bgColor: 'bg-violet-50 border-violet-100', dur: '15 min' },
                { time: WORK_SCHEDULE.logoutTime.label,           label: 'Logout',         color: 'bg-rose-500',    textColor: 'text-rose-700',    bgColor: 'bg-rose-50 border-rose-100' },
              ].map((item, i, arr) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex flex-col items-center w-5 shrink-0">
                    <div className={`w-3 h-3 rounded-full ${item.color} ring-2 ring-white shadow`} />
                    {i < arr.length - 1 && <div className="w-0.5 h-8 bg-gray-100 my-0.5" />}
                  </div>
                  <div className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg border ${item.bgColor} mb-0`}>
                    <div>
                      <p className={`text-xs font-black ${item.textColor}`}>{item.label}</p>
                      {'dur' in item && <p className="text-[9px] text-gray-400 font-bold">{(item as any).dur}</p>}
                    </div>
                    <p className={`text-[11px] font-black ${item.textColor} tabular-nums`}>{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[10px] text-gray-400 font-semibold flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <CheckCircle size={12} className="text-emerald-500 shrink-0" />
              Compulsory working hours: <span className="text-gray-700 font-black">8 hours/day</span> — breaks excluded from active time
            </p>
          </Card>

          {/* ── My Tasks Panel ─────────────────────────────────────── */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <ListTodo size={14} className="text-indigo-500" />
                My Assigned Tasks
              </h4>
              <span className="text-xs font-black bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full">
                {tasks.filter(t => t.status !== 'completed').length} open
              </span>
            </div>

            {tasks.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-semibold">No tasks assigned yet</p>
                <p className="text-xs mt-1">Your team lead will assign tasks here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map(task => {
                  const pConf = PRIORITY_CONF[task.priority] || PRIORITY_CONF.medium;
                  const sConf = TASK_STATUS_CONF[task.status] || TASK_STATUS_CONF.pending;
                  const StatusIcon = sConf.icon;
                  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';
                  return (
                    <div key={task.id} className={`flex flex-col sm:flex-row gap-3 p-4 rounded-2xl border transition-all ${task.status === 'completed' ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200 hover:border-indigo-200 hover:shadow-sm'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className={`text-sm font-black text-gray-900 ${task.status === 'completed' ? 'line-through text-gray-400' : ''}`}>{task.title}</p>
                          <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full ${pConf.bg} ${pConf.text}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${pConf.dot}`} />
                            {task.priority.toUpperCase()}
                          </span>
                          {isOverdue && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">
                              <AlertCircle size={10} /> OVERDUE
                            </span>
                          )}
                        </div>
                        {task.description && (
                          <pre className="text-[11px] font-mono bg-gray-900 text-green-300 rounded-xl px-3 py-2.5 mb-2 whitespace-pre-wrap break-words max-h-36 overflow-y-auto leading-relaxed border border-gray-700 select-text">
                            {task.description}
                          </pre>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-400 font-semibold">
                          <span className="flex items-center gap-1">
                            <UserCog size={10} /> Assigned by: {task.assignedByName || 'Team Lead'}
                          </span>
                          {task.groupName && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 font-black">
                              🗂️ {task.groupName}
                            </span>
                          )}
                          {task.dueDate && (
                            <span className="flex items-center gap-1">
                              <Calendar size={10} /> Due: {format(new Date(task.dueDate), 'MMM d, yyyy')}
                            </span>
                          )}
                        </div>

                        {/* Submission area */}
                        {task.submission ? (
                          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                              ✅ Your Answer — submitted {task.submittedAt ? format(new Date(task.submittedAt), 'MMM d, h:mm a') : ''}
                            </p>
                            <pre className="text-[11px] font-mono text-emerald-800 whitespace-pre-wrap break-words leading-relaxed">{task.submission}</pre>
                          </div>
                        ) : (
                          <SubmitAnswerBox taskId={task.id} token={token} onSubmitted={fetchTasks} />
                        )}
                      </div>
                      {/* Status dropdown */}
                      <div className="shrink-0 flex items-start">
                        <select
                          value={task.status}
                          onChange={e => updateTaskStatus(task.id, e.target.value)}
                          className={`text-xs font-black px-3 py-1.5 rounded-xl border outline-none cursor-pointer ${sConf.cls} bg-white border-gray-200 focus:ring-2 focus:ring-indigo-400`}
                          disabled={task.status === 'completed'}
                        >
                          <option value="pending">⏳ Pending</option>
                          <option value="in_progress">▶ In Progress</option>
                          <option value="completed">✅ Completed</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ── Right column ───────────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-6">

          {/* Calendar */}
          <Card className="p-6">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-5">Attendance Calendar</h4>
            <MonthlyWorkCalendar logs={logs} />
          </Card>

          {/* Live Timeline */}
          <Card className="p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Live Timeline</h4>
              <div className="w-7 h-7 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                <Activity size={14} />
              </div>
            </div>
            <div className="space-y-4 relative before:content-[''] before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100 min-h-[160px]">
              {todayLogs.length === 0 ? (
                <p className="text-xs text-gray-400 pl-8">No events recorded today.</p>
              ) : [...todayLogs].reverse().map((log, idx) => {
                const ringCls = LOG_COLORS[log.type] || 'bg-gray-400 ring-gray-300';
                return (
                  <div key={log.id} className="relative pl-8">
                    <div className={`absolute left-[11px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white ring-2 ${ringCls}`} />
                    <div>
                      <p className="text-xs font-black text-gray-900 leading-tight">{LOG_LABELS[log.type] || log.type}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-semibold">{format(new Date(log.timestamp), 'hh:mm:ss a')}</p>
                      {log.note && <p className="text-[10px] text-indigo-600 mt-1 italic bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100">"{log.note}"</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* GPS tracking — login + latest live location */}
          <Card className="p-5 border border-gray-200">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <MapPin size={13} className="text-indigo-500" />
              Location Tracking
            </h4>
            {(() => {
              const loginLog = todayLogs.find(l => l.type === 'login');
              const latestLocLog = [...todayLogs]
                .filter(l => (l.type === 'location_update' || l.type === 'login') && l.location)
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

              if (!loginLog?.location && !latestLocLog?.location) return (
                <p className="text-xs text-gray-400">Location not captured yet. Enable GPS permissions in your browser to track your location.</p>
              );

              const loginLoc = loginLog?.location;
              const latestLoc = latestLocLog?.location;
              const isLive = latestLocLog?.type === 'location_update';

              return (
                <div className="space-y-3">
                  {/* Login location */}
                  {loginLoc && (
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Punch-in Location</p>
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <p className="text-[11px] font-bold text-gray-700">📍 {loginLoc.lat.toFixed(5)}, {loginLoc.lng.toFixed(5)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{loginLog && format(new Date(loginLog.timestamp), 'h:mm a')}</p>
                      </div>
                      <a href={`https://www.google.com/maps?q=${loginLoc.lat},${loginLoc.lng}`} target="_blank" rel="noopener noreferrer"
                        className="mt-1.5 flex items-center gap-1.5 justify-center w-full py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-600 text-[10px] font-black rounded-xl hover:bg-indigo-100 transition-all">
                        <MapPin size={10} /> View Punch-in on Map
                      </a>
                    </div>
                  )}

                  {/* Latest live location */}
                  {isLive && latestLoc && (
                    <div>
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block" />
                        Live Location · {latestLocLog && format(new Date(latestLocLog.timestamp), 'h:mm a')}
                      </p>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                        <p className="text-[11px] font-bold text-emerald-700">📍 {latestLoc.lat.toFixed(5)}, {latestLoc.lng.toFixed(5)}</p>
                        <p className="text-[10px] text-emerald-500 mt-0.5">Updated every 5 minutes while working</p>
                      </div>
                      <a href={`https://www.google.com/maps?q=${latestLoc.lat},${latestLoc.lng}`} target="_blank" rel="noopener noreferrer"
                        className="mt-1.5 flex items-center gap-1.5 justify-center w-full py-1.5 bg-emerald-600 text-white text-[10px] font-black rounded-xl hover:bg-emerald-700 transition-all">
                        <MapPin size={10} /> View Live Location on Map
                      </a>
                    </div>
                  )}
                </div>
              );
            })()}
          </Card>
        </div>
      </div>

      {/* ── Finish Day Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {showFinishModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFinishModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md z-10 overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                    <CheckCircle size={26} className="text-white" />
                  </div>
                  <button onClick={() => setShowFinishModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                    <X size={18} />
                  </button>
                </div>
                <h3 className="text-xl font-black">Finish Your Day?</h3>
                <p className="text-emerald-100 text-sm mt-1">This will record your punch-out with your current location.</p>
              </div>
              {/* Day summary */}
              <div className="p-6">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Today's Summary</h4>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: 'Hours Worked', value: `${activeH}h ${activeM}m`, color: 'text-indigo-600' },
                    { label: 'Punch Events', value: todayLogs.length, color: 'text-emerald-600' },
                    { label: 'Tasks Open', value: tasks.filter(t => t.status !== 'completed').length, color: 'text-amber-600' },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 rounded-2xl p-3 text-center border border-gray-100">
                      <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                      <p className="text-[9px] text-gray-400 font-semibold mt-0.5 uppercase tracking-wide">{s.label}</p>
                    </div>
                  ))}
                </div>
                {activeH < WORK_SCHEDULE.requiredHours && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                    <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 font-semibold">
                      You've worked {activeH}h {activeM}m of the required {WORK_SCHEDULE.requiredHours}h.
                      {WORK_SCHEDULE.requiredHours * 60 - activeMins > 0 && ` ${Math.floor((WORK_SCHEDULE.requiredHours * 60 - activeMins) / 60)}h ${(WORK_SCHEDULE.requiredHours * 60 - activeMins) % 60}m remaining.`}
                    </p>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowFinishModal(false)}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 text-sm font-black rounded-xl hover:bg-gray-200 transition-all">
                    Keep Working
                  </button>
                  <button
                    onClick={() => { setShowFinishModal(false); handleAction('logout'); }}
                    disabled={loading}
                    className="flex-1 py-3 bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-sm font-black rounded-xl hover:from-emerald-600 hover:to-teal-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={16} />
                    Finish Day
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Team Lead Dashboard
// ─────────────────────────────────────────────────────────────────────────────
// Avatar colour palette — consistent per employee name
const AVATAR_COLORS = [
  'bg-indigo-500','bg-violet-500','bg-sky-500','bg-emerald-500',
  'bg-rose-500','bg-amber-500','bg-pink-500','bg-teal-500',
  'bg-orange-500','bg-cyan-500','bg-lime-600','bg-fuchsia-500',
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const TeamLeadDashboard = () => {
  const { user, token } = useAuth();
  const [teamData, setTeamData] = useState<{ users: UserType[]; logs: TimeLog[] }>({ users: [], logs: [] });
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [search, setSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<UserType | null>(null);
  const [isAddEmployeeOpen, setIsAddEmployeeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'groups'>('members');
  const [groups, setGroups] = useState<Group[]>([]);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [groupMemberModal, setGroupMemberModal] = useState<Group | null>(null);

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await apiFetch('/api/groups', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setGroups(await res.json());
    } catch (err) { console.error(err); }
  };

  const fetchTeamData = async () => {
    try {
      const [teamRes, taskRes] = await Promise.all([
        apiFetch('/api/teamlead/data', { headers: { Authorization: `Bearer ${token}` } }),
        apiFetch('/api/tasks',         { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (teamRes.ok) {
        const team = await teamRes.json();
        setTeamData({
          users: Array.isArray(team.users) ? team.users : [],
          logs:  Array.isArray(team.logs)  ? team.logs  : [],
        });
      }
      if (taskRes.ok) {
        const taskData = await taskRes.json();
        setTasks(Array.isArray(taskData) ? taskData : []);
      }
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    fetchTeamData();
    fetchGroups();
    // Auto-refresh every 30 seconds so team lead sees live updates without reloading
    const interval = setInterval(fetchTeamData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const todayStr = format(currentTime, 'yyyy-MM-dd');
  const todayLogs = teamData.logs.filter(l => l.timestamp.startsWith(todayStr));

  const getMemberStatus = (uid: string): 'Working' | 'On Break' | 'On Lunch' | 'Absent' | 'Left' => {
    const uLogs = [...todayLogs.filter(l => l.userId === uid)].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    // Skip idle and daily_report events — they don't change work status
    const last = [...uLogs].reverse().find(l =>
      l.type !== 'daily_report' &&
      l.type !== 'idle_start' &&
      l.type !== 'idle_end' &&
      l.type !== 'location_update'
    );
    if (!last) return 'Absent';
    if (last.type === 'login' || last.type === 'break_end' || last.type === 'lunch_out') return 'Working';
    if (last.type === 'break_start') return 'On Break';
    if (last.type === 'lunch_in')  return 'On Lunch';
    if (last.type === 'logout')    return 'Left';
    return 'Absent';
  };

  const STATUS_CONF: Record<string, { bg: string; text: string; dot: string }> = {
    Working:   { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    'On Break':{ bg: 'bg-sky-50',     text: 'text-sky-700',     dot: 'bg-sky-400'     },
    'On Lunch':{ bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400'   },
    Absent:    { bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400'    },
    Left:      { bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-400'    },
  };

  const PRIORITY_CONF: Record<string, { bg: string; border: string; text: string }> = {
    urgent:  { bg: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-700'   },
    high:    { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
    medium:  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700'  },
    low:     { bg: 'bg-sky-50',    border: 'border-sky-200',    text: 'text-sky-700'    },
  };

  const statuses = teamData.users.map(u => getMemberStatus(u.id));
  const presentCount = statuses.filter(s => s === 'Working' || s === 'On Break' || s === 'On Lunch' || s === 'Left').length;
  const workingCount = statuses.filter(s => s === 'Working').length;
  const absentCount  = statuses.filter(s => s === 'Absent').length;

  const openTasks = tasks.filter(t => t.status !== 'completed').length;
  const doneTasks = tasks.filter(t => t.status === 'completed').length;

  // Late arrival: login time > 9:30 AM (grace 5 min → flag after 9:35)
  const LATE_THRESHOLD_MINS = 5; // grace period in minutes
  const scheduledLoginHour  = 9;
  const scheduledLoginMin   = 30;

  const getLateInfo = (uid: string): { isLate: boolean; minsLate: number; punchInTime: Date | null } => {
    const punchIn = todayLogs
      .filter(l => l.userId === uid && l.type === 'login')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
    if (!punchIn) return { isLate: false, minsLate: 0, punchInTime: null };
    const punchTime   = new Date(punchIn.timestamp);
    const scheduled   = new Date(punchTime);
    scheduled.setHours(scheduledLoginHour, scheduledLoginMin, 0, 0);
    const diffMins    = differenceInMinutes(punchTime, scheduled);
    return {
      isLate:      diffMins > LATE_THRESHOLD_MINS,
      minsLate:    Math.max(0, diffMins),
      punchInTime: punchTime,
    };
  };

  const lateArrivals = teamData.users
    .map(u => ({ user: u, ...getLateInfo(u.id) }))
    .filter(x => x.isLate)
    .sort((a, b) => b.minsLate - a.minsLate);

  const lateCount = lateArrivals.length;

  // Idle detection for team lead: only idle if last idle_start has no idle_end after it
  // AND the employee is currently supposed to be working (punched in)
  const getIdleInfo = (uid: string): { isIdle: boolean; idleSince: Date | null } => {
    const uLogs = todayLogs
      .filter(l => l.userId === uid && l.type !== 'daily_report' && l.type !== 'location_update')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (uLogs.length === 0) return { isIdle: false, idleSince: null };
    const last = uLogs[uLogs.length - 1];
    // Only mark idle if the very last event is idle_start (meaning no idle_end came after)
    // AND the employee is working (not on break/lunch/logged out)
    if (last.type !== 'idle_start') return { isIdle: false, idleSince: null };
    // Check if they were working before going idle
    const workLog = [...uLogs].reverse().find(l =>
      l.type === 'login' || l.type === 'break_end' || l.type === 'lunch_out' || l.type === 'idle_start'
    );
    if (!workLog || workLog.type === 'idle_start') {
      // Only idle if the last meaningful work event was indeed before idle_start
      const idleLog = last;
      const beforeIdle = [...uLogs].reverse().find(l =>
        new Date(l.timestamp) < new Date(idleLog.timestamp) &&
        (l.type === 'login' || l.type === 'break_end' || l.type === 'lunch_out')
      );
      if (!beforeIdle) return { isIdle: false, idleSince: null };
      return { isIdle: true, idleSince: new Date(last.timestamp) };
    }
    return { isIdle: false, idleSince: null };
  };

  const idleEmployees = teamData.users
    .map(u => ({ user: u, ...getIdleInfo(u.id) }))
    .filter(x => x.isIdle);
  const idleCount = idleEmployees.length;

  const deleteTask = async (id: string) => {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchTeamData();
  };

  // filtered employees for search
  const filteredMembers = teamData.users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    (u.department || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout title="Team Monitor">

      {/* ── Page header with actions ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-black text-gray-900">Team Monitor</h2>
          <p className="text-xs text-gray-400 font-semibold mt-0.5 flex items-center gap-2">
            {format(currentTime, 'EEEE, MMMM d, yyyy')} · {format(currentTime, 'h:mm a')}
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block" />
              Live · refreshes every 30s
            </span>
          </p>
        </div>
        <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search members..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-48 shadow-sm"
            />
          </div>
          <button
            onClick={() => setIsAddEmployeeOpen(true)}
            className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 text-xs font-black px-4 py-2.5 rounded-xl hover:bg-gray-50 shadow-sm transition-all"
          >
            <Plus size={14} />
            Add Member
          </button>
          <button
            onClick={() => { setEditTask(null); setIsTaskModalOpen(true); }}
            className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-black px-4 py-2.5 rounded-xl hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all"
          >
            <ClipboardList size={14} />
            Assign Task
          </button>
        </div>
      </div>

      {/* ── Stats row ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Team Size',    value: teamData.users.length, icon: Users,      color: 'bg-indigo-500'  },
          { label: 'Working Now',  value: workingCount,          icon: Activity,   color: 'bg-emerald-500' },
          { label: 'Late Today',   value: lateCount,             icon: Clock,      color: lateCount > 0 ? 'bg-rose-500' : 'bg-gray-400' },
          { label: 'Idle Now',     value: idleCount,             icon: WifiOff,    color: idleCount > 0 ? 'bg-orange-500' : 'bg-gray-400' },
          { label: 'Open Tasks',   value: openTasks,             icon: ListTodo,   color: 'bg-amber-500'  },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl ${s.color} flex items-center justify-center text-white shadow-lg shrink-0`}>
              <s.icon size={20} />
            </div>
            <div>
              <p className="text-3xl font-black text-gray-900 leading-none">{s.value}</p>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tab switcher ────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-2xl w-fit">
        {(['members', 'groups'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === tab
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            {tab === 'members' ? `👥 Members` : `🗂️ Groups (${groups.length})`}
          </button>
        ))}
      </div>

      {/* ── Late Arrivals Alert ──────────────────────────────────────── */}
      {activeTab === 'members' && lateArrivals.length > 0 && (
        <div className="mb-6 bg-rose-50 border-2 border-rose-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 bg-rose-500 rounded-xl flex items-center justify-center shrink-0">
              <Clock size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-rose-700">
                {lateArrivals.length} Late Arrival{lateArrivals.length > 1 ? 's' : ''} Today
              </p>
              <p className="text-[10px] text-rose-400 font-semibold">Scheduled login: 9:30 AM · Grace period: 5 min</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {lateArrivals.map(({ user: u, minsLate, punchInTime }) => (
              <button
                key={u.id}
                onClick={() => setSelectedMember(u)}
                className="flex items-center gap-2 bg-white border border-rose-200 rounded-xl px-3 py-2 hover:bg-rose-100 hover:border-rose-300 transition-all group"
              >
                <div className={`w-7 h-7 rounded-lg ${avatarColor(u.name)} text-white flex items-center justify-center text-xs font-black shrink-0`}>
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="text-left">
                  <p className="text-xs font-black text-gray-900 group-hover:text-rose-700 transition-colors">{u.name}</p>
                  <p className="text-[10px] font-bold text-rose-500">
                    {punchInTime ? format(punchInTime, 'h:mm a') : '—'} · <span className="text-rose-600">+{minsLate}m late</span>
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Idle Employees Alert ────────────────────────────────────── */}
      {activeTab === 'members' && idleEmployees.length > 0 && (
        <div className="mb-6 bg-orange-50 border-2 border-orange-300 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 bg-orange-500 rounded-xl flex items-center justify-center shrink-0 animate-pulse">
              <Monitor size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-orange-700">
                {idleEmployees.length} Employee{idleEmployees.length > 1 ? 's' : ''} Idle — System Off / Screen Locked
              </p>
              <p className="text-[10px] text-orange-400 font-semibold">No activity for 15+ minutes. System went to sleep or screen turned off.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {idleEmployees.map(({ user: u, idleSince }) => (
              <button
                key={u.id}
                onClick={() => setSelectedMember(u)}
                className="flex items-center gap-2 bg-white border border-orange-200 rounded-xl px-3 py-2 hover:bg-orange-50 hover:border-orange-300 transition-all group"
              >
                <div className={`w-7 h-7 rounded-lg ${avatarColor(u.name)} text-white flex items-center justify-center text-xs font-black shrink-0`}>
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="text-left">
                  <p className="text-xs font-black text-gray-900 group-hover:text-orange-700 transition-colors">{u.name}</p>
                  <p className="text-[10px] font-bold text-orange-500 flex items-center gap-1">
                    <WifiOff size={9} />
                    Idle since {idleSince ? format(idleSince, 'h:mm a') : '—'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Auto Punch-Out Alert (team lead view) ───────────────────────── */}
      {activeTab === 'members' && (() => {
        // Employees still punched in after 6:30 PM (approaching auto punch-out)
        const h = currentTime.getHours();
        const m = currentTime.getMinutes();
        const isApproaching = h === 18 && m >= 30 && m < 40;
        const isPastCutoff  = h > 18 || (h === 18 && m >= 40);

        // Auto-punched-out: logout logs with the auto note
        const autoPunchedOut = teamData.users.filter(u => {
          return todayLogs.some(l =>
            l.userId === u.id &&
            l.type   === 'logout' &&
            l.note   === 'Auto punch-out at 6:40 PM'
          );
        });

        // Still punched in after 6:30 PM warning threshold
        const stillInAfterWarning = isApproaching
          ? teamData.users.filter(u => {
              const s = getMemberStatus(u.id);
              return s === 'Working' || s === 'On Break' || s === 'On Lunch';
            })
          : [];

        if (isApproaching && stillInAfterWarning.length > 0) {
          return (
            <div className="mb-6 bg-amber-50 border-2 border-amber-400 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-amber-500 rounded-xl flex items-center justify-center shrink-0 animate-pulse">
                  <Clock size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-black text-amber-700">
                    {stillInAfterWarning.length} Employee{stillInAfterWarning.length > 1 ? 's' : ''} — Auto Punch-Out in {40 - m} min{40 - m !== 1 ? 's' : ''}
                  </p>
                  <p className="text-[10px] text-amber-500 font-semibold">These employees will be automatically punched out at 6:40 PM</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {stillInAfterWarning.map(u => (
                  <button key={u.id} onClick={() => setSelectedMember(u)}
                    className="flex items-center gap-2 bg-white border border-amber-200 rounded-xl px-3 py-2 hover:bg-amber-50 hover:border-amber-300 transition-all group">
                    <div className={`w-7 h-7 rounded-lg bg-amber-400 text-white flex items-center justify-center text-xs font-black shrink-0`}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <p className="text-xs font-black text-gray-900 group-hover:text-amber-700 transition-colors">{u.name}</p>
                  </button>
                ))}
              </div>
            </div>
          );
        }

        if (autoPunchedOut.length > 0) {
          return (
            <div className="mb-6 bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-indigo-500 rounded-xl flex items-center justify-center shrink-0">
                  <Clock size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-black text-indigo-700">
                    {autoPunchedOut.length} Employee{autoPunchedOut.length > 1 ? 's' : ''} Auto Punched Out at 6:40 PM
                  </p>
                  <p className="text-[10px] text-indigo-400 font-semibold">These employees did not punch out manually — system logged them out automatically.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {autoPunchedOut.map(u => (
                  <button key={u.id} onClick={() => setSelectedMember(u)}
                    className="flex items-center gap-2 bg-white border border-indigo-200 rounded-xl px-3 py-2 hover:bg-indigo-50 hover:border-indigo-300 transition-all group">
                    <div className={`w-7 h-7 rounded-lg bg-indigo-400 text-white flex items-center justify-center text-xs font-black shrink-0`}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-black text-gray-900 group-hover:text-indigo-700 transition-colors">{u.name}</p>
                      <p className="text-[10px] font-semibold text-indigo-400">Auto logged out · 6:40 PM</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        }

        return null;
      })()}

      {activeTab === 'groups' ? (
        /* ── Groups Panel ───────────────────────────────────────────── */
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Users size={14} className="text-indigo-500" />
              Groups · {groups.length}
            </h3>
            <button
              onClick={() => { setEditGroup(null); setIsGroupModalOpen(true); }}
              className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-black px-4 py-2 rounded-xl hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all"
            >
              <Plus size={14} /> New Group
            </button>
          </div>

          {groups.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-16 text-center">
              <Users size={40} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm font-black text-gray-400">No groups yet</p>
              <button
                onClick={() => { setEditGroup(null); setIsGroupModalOpen(true); }}
                className="mt-4 inline-flex items-center gap-2 bg-indigo-600 text-white text-xs font-black px-5 py-2.5 rounded-xl hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all"
              >
                <Plus size={14} /> Create First Group
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {groups.map(g => {
                const members = teamData.users.filter(u => g.memberIds.includes(u.id));
                return (
                  <div key={g.id} className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm hover:shadow-lg transition-all group">
                    {/* Color bar */}
                    <div className="h-1.5 rounded-full mb-4" style={{ backgroundColor: g.color }} />

                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-black text-gray-900 text-base leading-tight">{g.name}</h4>
                        {g.description && (
                          <p className="text-xs text-gray-400 font-medium mt-0.5 line-clamp-2">{g.description}</p>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <button
                          onClick={() => { setEditGroup(g); setIsGroupModalOpen(true); }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 hover:bg-indigo-50 hover:text-indigo-600 text-gray-400 transition-all"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete group "${g.name}"?`)) return;
                            await apiFetch(`/api/groups/${g.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                            fetchGroups();
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 hover:bg-rose-50 hover:text-rose-500 text-gray-400 transition-all"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Member avatars */}
                    <div className="flex items-center gap-2 mb-4">
                      <div className="flex -space-x-2">
                        {members.slice(0, 5).map(m => (
                          <div
                            key={m.id}
                            className={`w-8 h-8 rounded-full ${avatarColor(m.name)} text-white text-xs font-black flex items-center justify-center border-2 border-white shadow-sm`}
                            title={m.name}
                          >
                            {m.name.charAt(0)}
                          </div>
                        ))}
                        {members.length > 5 && (
                          <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 text-xs font-black flex items-center justify-center border-2 border-white">
                            +{members.length - 5}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 font-semibold ml-1">
                        {members.length} member{members.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <button
                      onClick={() => setGroupMemberModal(g)}
                      className="w-full py-2 rounded-xl border border-dashed border-gray-200 text-xs font-black text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                    >
                      + Manage Members
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (

      /* ── Employee Card Grid ───────────────────────────────────────── */
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Users size={14} className="text-indigo-500" />
            Team Members · {filteredMembers.length}
          </h3>
        </div>

        {filteredMembers.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-16 text-center">
            <Users size={40} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm font-black text-gray-400">
              {teamData.users.length === 0 ? 'No team members yet' : 'No results for your search'}
            </p>
            {teamData.users.length === 0 && (
              <button onClick={() => setIsAddEmployeeOpen(true)}
                className="mt-4 inline-flex items-center gap-2 bg-indigo-600 text-white text-xs font-black px-5 py-2.5 rounded-xl hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all">
                <Plus size={14} /> Add First Member
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMembers.map(u => {
              const status     = getMemberStatus(u.id);
              const conf       = STATUS_CONF[status] || STATUS_CONF.Absent;
              const uTodayLogs = todayLogs.filter(l => l.userId === u.id);
              const { hours, minutes } = calculateTotalHours(uTodayLogs);
              const productivity = Math.min(100, Math.round(((hours * 60 + minutes) / 480) * 100));
              const punchIn    = uTodayLogs.find(l => l.type === 'login');
              const myTasks    = tasks.filter(t => t.assignedTo === u.id && t.status !== 'completed');
              // Latest location: prefer most recent location_update, fallback to login location
              const latestLocLog = [...uTodayLogs]
                .filter(l => (l.type === 'location_update' || l.type === 'login' || l.type === 'logout') && l.location)
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
              const latestLocation = latestLocLog?.location ?? null;
              const latestLocTime  = latestLocLog ? new Date(latestLocLog.timestamp) : null;
              const initials   = u.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
              const { isLate, minsLate } = getLateInfo(u.id);
              const { isIdle, idleSince } = getIdleInfo(u.id);
              const memberGroups = groups.filter(g => g.memberIds.includes(u.id));
              // Break compliance for card badge
              const sortedULogs = [...uTodayLogs].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
              let bStart: string | null = null;
              let hasBreachBreak = false;
              for (const l of sortedULogs) {
                if (l.type === 'break_start') bStart = l.timestamp;
                else if (l.type === 'break_end' && bStart) {
                  if (differenceInMinutes(new Date(l.timestamp), new Date(bStart)) > 17) hasBreachBreak = true;
                  bStart = null;
                }
              }
              const lIn = sortedULogs.find(l => l.type === 'lunch_in');
              const lOut = sortedULogs.find(l => l.type === 'lunch_out');
              if (lIn && lOut && differenceInMinutes(new Date(lOut.timestamp), new Date(lIn.timestamp)) > 32) hasBreachBreak = true;
              return (
                <motion.div
                  key={u.id}
                  whileHover={{ y: -4, scale: 1.01 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  onClick={() => setSelectedMember(u)}
                  className={`bg-white border rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all cursor-pointer group ${isIdle ? 'border-orange-300 hover:border-orange-400 bg-orange-50/30' : isLate ? 'border-rose-200 hover:border-rose-300' : 'border-gray-200 hover:border-indigo-200'}`}
                >
                  {/* Top: avatar + status */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="relative">
                      <div className={`w-14 h-14 rounded-2xl ${avatarColor(u.name)} text-white flex items-center justify-center text-xl font-black shadow-lg`}>
                        {initials}
                      </div>
                      <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${conf.dot}`} />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black ${conf.bg} ${conf.text}`}>
                        {status}
                      </span>
                      {isLate && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-rose-100 text-rose-600 border border-rose-200">
                          <Clock size={9} /> +{minsLate}m late
                        </span>
                      )}
                      {hasBreachBreak && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-orange-100 text-orange-600 border border-orange-200">
                          <Coffee size={9} /> Break over
                        </span>
                      )}
                      {isIdle && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-orange-50 text-orange-700 border border-orange-300 animate-pulse">
                          <WifiOff size={9} /> Idle{idleSince ? ` · ${format(idleSince, 'h:mm a')}` : ''}
                        </span>
                      )}
                      {memberGroups.slice(0, 2).map(g => (
                        <span
                          key={g.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black border"
                          style={{ backgroundColor: g.color + '18', color: g.color, borderColor: g.color + '40' }}
                        >
                          🗂️ {g.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Name + dept */}
                  <p className={`font-black text-sm leading-tight mb-0.5 transition-colors ${isLate ? 'text-gray-900 group-hover:text-rose-600' : 'text-gray-900 group-hover:text-indigo-700'}`}>{u.name}</p>
                  <p className="text-[10px] text-gray-400 font-semibold mb-1">{u.department || 'No Department'}</p>
                  {u.employeeId && <p className="text-[10px] text-gray-300 font-semibold mb-3">ID: {u.employeeId}</p>}

                  {/* Productivity bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-[10px] font-black text-gray-400 mb-1">
                      <span>Productivity</span>
                      <span className={productivity >= 80 ? 'text-emerald-600' : productivity >= 50 ? 'text-amber-500' : 'text-gray-400'}>{productivity}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${productivity >= 80 ? 'bg-emerald-500' : productivity >= 50 ? 'bg-amber-400' : 'bg-gray-300'}`}
                        style={{ width: `${productivity}%` }}
                      />
                    </div>
                  </div>

                  {/* Footer stats */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <div className="text-center">
                      <p className="text-sm font-black text-gray-800">{hours > 0 || minutes > 0 ? `${hours}h ${minutes}m` : '—'}</p>
                      <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">Today</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-gray-800">{myTasks.length}</p>
                      <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">Open Tasks</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-black text-gray-600">{punchIn ? format(new Date(punchIn.timestamp), 'h:mm a') : '—'}</p>
                      <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">Punch In</p>
                    </div>
                  </div>
                  {/* Location link — shows latest tracked location */}
                  {latestLocation && (
                    <a
                      href={`https://www.google.com/maps?q=${latestLocation.lat},${latestLocation.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="mt-3 flex items-center justify-between gap-1.5 w-full px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black rounded-xl hover:bg-emerald-100 transition-all"
                    >
                      <span className="flex items-center gap-1.5">
                        <MapPin size={10} className="animate-pulse" />
                        📍 Live Location
                      </span>
                      {latestLocTime && (
                        <span className="text-emerald-500 font-semibold">
                          {format(latestLocTime, 'h:mm a')}
                        </span>
                      )}
                    </a>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
      )} {/* end members/groups ternary */}

      {/* ── Task panel ───────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/60">
          <div className="flex items-center gap-3">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} className="text-indigo-500" />
              Assigned Tasks
            </h4>
            <div className="flex items-center gap-1.5">
              {[
                { label: 'Open',       color: 'bg-gray-400',    v: tasks.filter(t=>t.status==='pending').length },
                { label: 'In Progress',color: 'bg-sky-500',     v: tasks.filter(t=>t.status==='in_progress').length },
                { label: 'Done',       color: 'bg-emerald-500', v: doneTasks },
              ].map(c => (
                <span key={c.label} className="flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                  <span className={`w-1.5 h-1.5 rounded-full ${c.color}`} />
                  {c.v} {c.label}
                </span>
              ))}
            </div>
          </div>
          {tasks.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-gray-400">
                {tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0}% complete
              </span>
              <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${tasks.length ? (doneTasks / tasks.length) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </div>

        {tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <ClipboardList size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-semibold">No tasks assigned yet</p>
            <p className="text-xs mt-1">Click "Assign Task" above to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {tasks.map(task => {
              const assignee = teamData.users.find(u => u.id === task.assignedTo);
              const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';
              const PCOL: Record<string, string> = {
                urgent: 'text-rose-600 bg-rose-50 border-rose-100',
                high: 'text-orange-600 bg-orange-50 border-orange-100',
                medium: 'text-amber-600 bg-amber-50 border-amber-100',
                low: 'text-sky-600 bg-sky-50 border-sky-100',
              };
              const SCOL: Record<string, string> = {
                pending: 'text-gray-600 bg-gray-100',
                in_progress: 'text-indigo-700 bg-indigo-100',
                completed: 'text-emerald-700 bg-emerald-100',
              };
              return (
                <div key={task.id} className={`flex flex-col gap-0 px-5 py-3.5 hover:bg-gray-50/70 transition-all group border-b border-gray-50 last:border-0 ${task.status === 'completed' ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-1 h-10 rounded-full shrink-0 ${task.priority === 'urgent' ? 'bg-rose-500' : task.priority === 'high' ? 'bg-orange-400' : task.priority === 'medium' ? 'bg-amber-400' : 'bg-sky-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-black truncate ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${PCOL[task.priority] || PCOL.medium}`}>{task.priority}</span>
                        {isOverdue && <span className="text-[9px] font-black px-1.5 py-0.5 rounded border uppercase text-rose-600 bg-rose-50 border-rose-100">Overdue</span>}
                        <span className="text-[10px] text-gray-400 font-semibold flex items-center gap-1">
                          <User size={9} /> {assignee?.name || 'Unknown'}
                        </span>
                        {task.groupName && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-600 border-indigo-100 flex items-center gap-0.5">
                            🗂️ {task.groupName}
                          </span>
                        )}
                        {task.dueDate && <span className="text-[10px] text-gray-400 font-semibold flex items-center gap-1"><Calendar size={9} /> {format(new Date(task.dueDate), 'MMM d')}</span>}
                        {task.description && (
                          <span className="text-[9px] font-semibold text-gray-400 flex items-center gap-0.5">
                            <FileText size={9} /> has notes
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full capitalize shrink-0 ${SCOL[task.status] || SCOL.pending}`}>{task.status.replace('_', ' ')}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => { setEditTask(task); setIsTaskModalOpen(true); }}
                        className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-all border border-transparent hover:border-indigo-100">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => deleteTask(task.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-gray-400 hover:text-rose-500 transition-all border border-transparent hover:border-rose-100">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {/* Notes / Code pad preview */}
                  {task.description && (
                    <div className="ml-5 mt-2">
                      <pre className="bg-gray-900 text-green-300 text-[11px] font-mono rounded-xl px-4 py-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-relaxed border border-gray-700 select-text">
                        {task.description}
                      </pre>
                    </div>
                  )}
                  {/* Employee submission */}
                  {task.submission && (
                    <div className="ml-5 mt-2 mb-1">
                      <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1 flex items-center gap-1">
                        ✅ Employee Answer · {task.submittedAt ? format(new Date(task.submittedAt), 'MMM d, h:mm a') : ''}
                      </p>
                      <pre className="bg-emerald-950 text-emerald-300 text-[11px] font-mono rounded-xl px-4 py-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-relaxed border border-emerald-800 select-text">
                        {task.submission}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Member Detail Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {selectedMember && (() => {
          const todayStr  = format(currentTime, 'yyyy-MM-dd');
          const uLogs     = teamData.logs.filter(l => l.userId === selectedMember.id && l.timestamp.startsWith(todayStr));
          const allLogs   = teamData.logs.filter(l => l.userId === selectedMember.id);
          const { hours, minutes } = calculateTotalHours(uLogs);
          const status    = getMemberStatus(selectedMember.id);
          const conf      = STATUS_CONF[status] || STATUS_CONF.Absent;
          const myTasks   = tasks.filter(t => t.assignedTo === selectedMember.id);
          return (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedMember(null)} />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto z-10">
                <div className="p-6">
                  {/* Header */}
                  <div className="flex items-center gap-4 mb-6">
                    <div className={`w-16 h-16 rounded-2xl ${avatarColor(selectedMember.name)} text-white flex items-center justify-center text-2xl font-black shadow-lg`}>
                      {selectedMember.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-black text-gray-900">{selectedMember.name}</h3>
                      <p className="text-sm text-gray-500">{selectedMember.department || 'No Department'} · {selectedMember.employeeId || 'No ID'}</p>
                      <span className={`inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full text-xs font-black ${conf.bg} ${conf.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
                        {status}
                      </span>
                    </div>
                    <button onClick={() => setSelectedMember(null)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                      <X size={20} className="text-gray-400" />
                    </button>
                  </div>

                  {/* Today stats */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { label: "Today's Hours", value: `${hours}h ${minutes}m`, color: 'text-indigo-600' },
                      { label: 'Punch Events',  value: uLogs.length,             color: 'text-emerald-600' },
                      { label: 'Open Tasks',    value: myTasks.filter(t => t.status !== 'completed').length, color: 'text-amber-600' },
                    ].map(s => (
                      <div key={s.label} className="bg-gray-50 rounded-2xl p-3 text-center">
                        <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Login location */}
                  {(() => {
                    const loginLog = uLogs.find(l => l.type === 'login');
                    const dayFinished = uLogs.some(l => l.type === 'logout');
                    return (
                      <div className={`mb-4 rounded-2xl border p-3 ${dayFinished ? 'bg-emerald-50 border-emerald-200' : loginLog?.location ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MapPin size={14} className={dayFinished ? 'text-emerald-600' : loginLog?.location ? 'text-indigo-600' : 'text-gray-400'} />
                            <div>
                              <p className={`text-xs font-black ${dayFinished ? 'text-emerald-700' : loginLog?.location ? 'text-indigo-700' : 'text-gray-500'}`}>
                                {dayFinished ? '✅ Day Finished' : loginLog?.location ? '📍 Working from:' : 'Location not captured'}
                              </p>
                              {loginLog?.location && (
                                <p className="text-[10px] text-gray-500 font-semibold">
                                  {loginLog.location.lat.toFixed(4)}, {loginLog.location.lng.toFixed(4)}
                                </p>
                              )}
                            </div>
                          </div>
                          {loginLog?.location && (
                            <a
                              href={`https://www.google.com/maps?q=${loginLog.location.lat},${loginLog.location.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] font-black text-indigo-600 bg-white border border-indigo-200 px-2.5 py-1.5 rounded-xl hover:bg-indigo-100 transition-all"
                            >
                              <ExternalLink size={10} />
                              Maps
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Today's timeline */}
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Today's Activity</h4>
                  {uLogs.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No activity today</p>
                  ) : (
                    <div className="space-y-2 mb-5">
                      {[...uLogs].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map(log => (
                        <div key={log.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-xl">
                          <div className={`w-2 h-2 rounded-full ${LOG_COLORS[log.type]?.split(' ')[0] || 'bg-gray-400'}`} />
                          <span className="text-xs font-bold text-gray-700 flex-1">{LOG_LABELS[log.type] || log.type}</span>
                          <span className="text-[10px] text-gray-400 font-semibold">{format(new Date(log.timestamp), 'hh:mm a')}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Break Compliance */}
                  {(() => {
                    const sortedLogs = [...uLogs].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    const breakSessions: { name: string; allowed: number; actual: number | null; onTime: boolean | null }[] = [];

                    // Morning / Evening breaks (break_start → break_end pairs)
                    let pendingBreakStart: string | null = null;
                    let breakCount = 0;
                    for (const log of sortedLogs) {
                      if (log.type === 'break_start') { pendingBreakStart = log.timestamp; }
                      else if (log.type === 'break_end' && pendingBreakStart) {
                        breakCount++;
                        const actual = differenceInMinutes(new Date(log.timestamp), new Date(pendingBreakStart));
                        breakSessions.push({ name: breakCount === 1 ? 'Morning Break' : 'Evening Break', allowed: 15, actual, onTime: actual <= 15 + 2 });
                        pendingBreakStart = null;
                      }
                    }
                    if (pendingBreakStart) {
                      // Break still ongoing
                      const elapsed = differenceInMinutes(new Date(), new Date(pendingBreakStart));
                      breakSessions.push({ name: breakCount === 0 ? 'Morning Break' : 'Evening Break', allowed: 15, actual: null, onTime: null });
                    }

                    // Lunch (lunch_in → lunch_out)
                    const lunchIn  = sortedLogs.find(l => l.type === 'lunch_in');
                    const lunchOut = sortedLogs.find(l => l.type === 'lunch_out');
                    if (lunchIn) {
                      if (lunchOut) {
                        const actual = differenceInMinutes(new Date(lunchOut.timestamp), new Date(lunchIn.timestamp));
                        breakSessions.push({ name: 'Lunch Break', allowed: 30, actual, onTime: actual <= 30 + 2 });
                      } else {
                        breakSessions.push({ name: 'Lunch Break', allowed: 30, actual: null, onTime: null });
                      }
                    }

                    if (breakSessions.length === 0) return null;
                    return (
                      <div className="mb-5">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                          <Coffee size={12} className="text-amber-500" />
                          Break Compliance
                        </h4>
                        <div className="space-y-2">
                          {breakSessions.map((b, i) => (
                            <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${b.onTime === null ? 'bg-amber-50 border-amber-200' : b.onTime ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                              <div>
                                <p className="text-xs font-black text-gray-800">{b.name}</p>
                                <p className="text-[10px] text-gray-500 font-semibold">
                                  Allowed: {b.allowed} min
                                  {b.actual !== null && ` · Taken: ${b.actual} min`}
                                </p>
                              </div>
                              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
                                b.onTime === null ? 'bg-amber-100 text-amber-700' :
                                b.onTime ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {b.onTime === null ? '🕐 In Progress' : b.onTime ? '✅ On Time' : `⚠️ +${b.actual! - b.allowed}m over`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Assigned tasks */}
                  {myTasks.length > 0 && (
                    <>
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Assigned Tasks</h4>
                      <div className="space-y-2">
                        {myTasks.map(t => (
                          <div key={t.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl gap-2">
                            <p className="text-xs font-bold text-gray-800 truncate flex-1">{t.title}</p>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full capitalize shrink-0 ${
                              t.status === 'completed'   ? 'bg-emerald-100 text-emerald-700' :
                              t.status === 'in_progress' ? 'bg-indigo-100 text-indigo-700'  :
                              'bg-gray-100 text-gray-600'}`}>
                              {t.status.replace('_',' ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Assign task to this member */}
                  <button
                    onClick={() => { setSelectedMember(null); setEditTask(null); setIsTaskModalOpen(true); }}
                    className="mt-5 w-full py-3 bg-indigo-600 text-white text-sm font-black rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200 flex items-center justify-center gap-2">
                    <Plus size={16} /> Assign Task to {selectedMember.name.split(' ')[0]}
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* ── Group Create / Edit Modal ─────────────────────────────── */}
      <AnimatePresence>
        {isGroupModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-black text-gray-900">{editGroup ? 'Edit Group' : 'New Group'}</h3>
                <button onClick={() => setIsGroupModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <form onSubmit={async e => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget as HTMLFormElement);
                const body = {
                  name:        fd.get('name') as string,
                  description: fd.get('description') as string,
                  color:       fd.get('color') as string,
                };
                if (editGroup) {
                  await apiFetch(`/api/groups/${editGroup.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify(body),
                  });
                } else {
                  await apiFetch('/api/groups', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify(body),
                  });
                }
                setIsGroupModalOpen(false);
                setEditGroup(null);
                fetchGroups();
              }} className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Group Name *</label>
                  <input name="name" required defaultValue={editGroup?.name ?? ''} placeholder="e.g. Team Alpha"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Description</label>
                  <input name="description" defaultValue={editGroup?.description ?? ''} placeholder="Optional description"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Group Color</label>
                  <div className="flex gap-3 items-center">
                    {['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'].map(c => (
                      <label key={c} className="cursor-pointer">
                        <input type="radio" name="color" value={c} defaultChecked={(editGroup?.color ?? '#6366f1') === c} className="sr-only" />
                        <div className="w-7 h-7 rounded-full border-2 border-white shadow-md hover:scale-110 transition-transform" style={{ backgroundColor: c }} />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setIsGroupModalOpen(false)}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-black text-gray-500 hover:bg-gray-50 transition-all">
                    Cancel
                  </button>
                  <button type="submit"
                    className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all">
                    {editGroup ? 'Save Changes' : 'Create Group'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Group Member Management Modal ─────────────────────────── */}
      <AnimatePresence>
        {groupMemberModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-black text-gray-900">Manage Members</h3>
                  <p className="text-xs text-gray-400 font-semibold mt-0.5">{groupMemberModal.name}</p>
                </div>
                <button onClick={() => setGroupMemberModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {teamData.users.filter(u => !u.isDeleted).map(u => {
                  const isMember = groupMemberModal.memberIds.includes(u.id);
                  return (
                    <div key={u.id} className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${isMember ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-100'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl ${avatarColor(u.name)} text-white flex items-center justify-center text-sm font-black`}>
                          {u.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-800">{u.name}</p>
                          <p className="text-[10px] text-gray-400 font-semibold">{u.department || 'No Dept'}</p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          const url = isMember
                            ? `/api/groups/${groupMemberModal.id}/members/${u.id}`
                            : `/api/groups/${groupMemberModal.id}/members/${u.id}`;
                          const method = isMember ? 'DELETE' : 'POST';
                          const res = await apiFetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
                          if (res.ok) {
                            const updated = await res.json();
                            setGroupMemberModal(updated);
                            fetchGroups();
                          }
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                          isMember
                            ? 'bg-indigo-600 text-white hover:bg-rose-500'
                            : 'bg-white border border-gray-200 text-gray-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600'
                        }`}
                      >
                        {isMember ? 'Remove' : '+ Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => setGroupMemberModal(null)}
                className="mt-4 w-full py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-black hover:bg-gray-200 transition-all"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Employee Modal */}
      <AddEmployeeModal isOpen={isAddEmployeeOpen} onClose={() => setIsAddEmployeeOpen(false)} token={token} onRefresh={fetchTeamData} />

      {/* Task Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => { setIsTaskModalOpen(false); setEditTask(null); }}
        token={token}
        users={teamData.users}
        groups={groups}
        editTask={editTask}
        onRefresh={fetchTeamData}
      />
    </DashboardLayout>
  );
};

// Task create / edit modal
const TaskModal = ({
  isOpen, onClose, token, users, groups = [], editTask, onRefresh
}: {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  users: UserType[];
  groups?: Group[];
  editTask: Task | null;
  onRefresh: () => void;
}) => {
  const emptyForm = { title: '', description: '', priority: 'medium', dueDate: '' };
  const [form, setForm]             = useState(emptyForm);
  const [assignMode, setAssignMode] = useState<'member' | 'group'>('member');
  const [assignedTo, setAssignedTo] = useState('');   // single member id
  const [assignedGroup, setAssignedGroup] = useState(''); // group id
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    if (editTask) {
      setForm({
        title:       editTask.title,
        description: editTask.description,
        priority:    editTask.priority,
        dueDate:     editTask.dueDate ? editTask.dueDate.substring(0, 10) : '',
      });
      setAssignMode('member');
      setAssignedTo(editTask.assignedTo);
      setAssignedGroup('');
    } else {
      setForm(emptyForm);
      setAssignMode('member');
      setAssignedTo('');
      setAssignedGroup('');
    }
    setError('');
  }, [editTask, isOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Task title is required'); return; }
    if (assignMode === 'member' && !assignedTo)    { setError('Please select a team member'); return; }
    if (assignMode === 'group'  && !assignedGroup) { setError('Please select a group'); return; }
    setLoading(true);
    setError('');

    try {
      if (editTask) {
        // Edit is always single-member
        const res = await apiFetch(`/api/tasks/${editTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...form, assignedTo, dueDate: form.dueDate || null }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed');
      } else if (assignMode === 'group') {
        // Create one task per group member
        const group  = groups.find(g => g.id === assignedGroup);
        const mids   = group?.memberIds ?? [];
        if (mids.length === 0) throw new Error('This group has no members');
        const results = await Promise.all(
          mids.map(uid =>
            apiFetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                ...form,
                assignedTo: uid,
                dueDate: form.dueDate || null,
                groupId:   group!.id,
                groupName: group!.name,
              }),
            })
          )
        );
        const failed = results.filter(r => !r.ok);
        if (failed.length > 0) throw new Error(`${failed.length} assignment(s) failed`);
      } else {
        // Single member
        const res = await apiFetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...form, assignedTo, dueDate: form.dueDate || null }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed');
      }
      onRefresh();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedGroup = groups.find(g => g.id === assignedGroup);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="p-6 border-b border-gray-100 bg-indigo-50/40 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                  <ClipboardList size={20} className="text-indigo-600" />
                  {editTask ? 'Edit Task' : 'Assign New Task'}
                </h3>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
                  {editTask ? 'Update task details' : 'Assign to a member or an entire group'}
                </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-red-500 transition-all border border-transparent hover:border-gray-100">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {error && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2">
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Task Title *</label>
                <input
                  required type="text" placeholder="e.g. Prepare weekly report"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none focus:bg-white transition-all"
                  value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                />
              </div>

              {/* Description / Notepad */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1 flex items-center gap-1.5">
                  <FileText size={11} /> Notes / Code Pad
                  <span className="text-gray-300 font-normal normal-case tracking-normal">— paste instructions, code snippets, links</span>
                </label>
                <textarea
                  rows={6}
                  placeholder={"Write task details, paste code, add links...\n\nExample:\n  function hello() {\n    console.log('Hello World');\n  }"}
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none focus:bg-gray-800 transition-all resize-y font-mono text-green-300 placeholder-gray-600 leading-relaxed"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  onKeyDown={e => {
                    // Support Tab key for indentation
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const start = el.selectionStart;
                      const end = el.selectionEnd;
                      const newVal = el.value.substring(0, start) + '  ' + el.value.substring(end);
                      setForm({ ...form, description: newVal });
                      setTimeout(() => { el.selectionStart = el.selectionEnd = start + 2; }, 0);
                    }
                  }}
                />
                <p className="text-[9px] text-gray-400 pl-1">Press Tab to indent · Drag bottom-right corner to resize</p>
              </div>

              {/* Assign mode toggle — only for new tasks */}
              {!editTask && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Assign To *</label>
                  <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setAssignMode('member')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black transition-all ${assignMode === 'member' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}
                    >
                      <User size={13} /> Member
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignMode('group')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black transition-all ${assignMode === 'group' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}
                    >
                      <Users size={13} /> Group
                    </button>
                  </div>

                  {/* Member picker */}
                  {assignMode === 'member' && (
                    <select
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none focus:bg-white transition-all"
                      value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                    >
                      <option value="">Select a team member...</option>
                      {users.filter(u => !u.isDeleted).map(u => (
                        <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ''}</option>
                      ))}
                    </select>
                  )}

                  {/* Group picker */}
                  {assignMode === 'group' && (
                    <>
                      {groups.length === 0 ? (
                        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-700">
                          No groups created yet. Go to the Groups tab to create one first.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 gap-2 max-h-36 overflow-y-auto pr-1">
                            {groups.map(g => {
                              const count = g.memberIds.length;
                              return (
                                <button
                                  key={g.id}
                                  type="button"
                                  onClick={() => setAssignedGroup(g.id)}
                                  className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                                    assignedGroup === g.id
                                      ? 'border-indigo-400 bg-indigo-50'
                                      : 'border-gray-100 bg-gray-50 hover:border-indigo-200'
                                  }`}
                                >
                                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-black text-gray-800 truncate">{g.name}</p>
                                    {g.description && <p className="text-[10px] text-gray-400 truncate">{g.description}</p>}
                                  </div>
                                  <span className="text-[10px] font-black text-gray-400 shrink-0">{count} member{count !== 1 ? 's' : ''}</span>
                                  {assignedGroup === g.id && <CheckCircle size={16} className="text-indigo-500 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                          {selectedGroup && selectedGroup.memberIds.length > 0 && (
                            <p className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl">
                              ✅ This task will be assigned to all {selectedGroup.memberIds.length} members of <strong>{selectedGroup.name}</strong>
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Edit mode: plain member selector */}
              {editTask && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Assigned To</label>
                  <select
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none focus:bg-white transition-all"
                    value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                  >
                    <option value="">Select a team member...</option>
                    {users.filter(u => !u.isDeleted).map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Priority + Due Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Priority</label>
                  <select
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none focus:bg-white transition-all"
                    value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Due Date</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none focus:bg-white transition-all"
                    value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
                    min={format(new Date(), 'yyyy-MM-dd')}
                  />
                </div>
              </div>

              </div> {/* end scrollable area */}

              {/* Actions — fixed at bottom */}
              <div className="flex gap-3 p-6 pt-4 border-t border-gray-100 bg-white">
                <button type="button" onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-black text-gray-600 hover:bg-gray-50 transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all disabled:opacity-50">
                  {loading
                    ? 'Saving...'
                    : editTask
                    ? 'Update Task'
                    : assignMode === 'group' && selectedGroup
                    ? `Assign to ${selectedGroup.memberIds.length} Members`
                    : 'Assign Task'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const StatCard = ({ title, value, subtitle, icon: Icon, color, trend }: any) => {
  const iconColorMap: any = {
    green: 'bg-emerald-50 text-emerald-600 border border-emerald-100/50',
    red: 'bg-rose-50 text-rose-600 border border-rose-100/50',
    blue: 'bg-blue-50 text-blue-600 border border-blue-100/50',
    orange: 'bg-amber-50 text-amber-600 border border-amber-100/50',
    indigo: 'bg-indigo-50 text-indigo-600 border border-indigo-100/50',
  };
  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200/80 shadow-sm hover:shadow-md transition-all duration-200 h-full flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
        <div className="flex items-center gap-2">
          {trend && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
              {trend}% attendance
            </span>
          )}
          <div className={`p-2 rounded-lg ${iconColorMap[color] || iconColorMap.indigo}`}>
            <Icon size={18} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-2.5">
        <h4 className="text-2xl font-bold tracking-tight text-gray-900 font-sans">{value}</h4>
        {subtitle && <span className="text-xs font-normal text-gray-500">{subtitle}</span>}
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const configs: any = {
    'Working':  { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-100', dot: 'bg-emerald-500' },
    'On Break': { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-100',   dot: 'bg-amber-500'   },
    'Overtime': { bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-100',  dot: 'bg-indigo-500'  },
    'Offline':  { bg: 'bg-gray-100',   text: 'text-gray-600',    ring: 'ring-gray-200',    dot: 'bg-gray-400'    },
    'Absent':   { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-100',    dot: 'bg-rose-500'    },
  };
  const config = configs[status] || configs['Offline'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-tight ${config.bg} ${config.text} ring-1 ${config.ring}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {status}
    </span>
  );
};

const AdminDashboard = () => {
  const { token } = useAuth();
  const [data, setData] = useState<{ users: any[], logs: any[] }>({ users: [], logs: [] });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchData = async () => {
    try {
      const res = await apiFetch('/api/admin/data', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return; // don't overwrite state on 401/403
      const json = await res.json();
      setData({
        users: Array.isArray(json.users) ? json.users : [],
        logs:  Array.isArray(json.logs)  ? json.logs  : [],
      });
    } catch (err) { console.error('Failed to fetch admin data', err); }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [token]);

  const getUsersWithCalculatedData = useMemo(() => {
    const todayStr  = format(new Date(), 'yyyy-MM-dd');
    const todayLogs = data.logs.filter(l => format(new Date(l.timestamp), 'yyyy-MM-dd') === todayStr);
    return data.users.filter(u => u.role === 'user').map(user => {
      const uLogs    = todayLogs.filter(l => l.userId === user.id);
      const allULogs = data.logs.filter(l => l.userId === user.id);
      const lastLog  = [...allULogs].reverse().find((l: any) => l.type !== 'daily_report');
      const todayDailyReports = uLogs.filter(l => l.type === 'daily_report');
      const latestReport = todayDailyReports.length > 0
        ? [...todayDailyReports].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0].note
        : 'No report submitted';
      const { hours, minutes } = calculateTotalHours(uLogs.filter(l => l.type !== 'daily_report'));
      let status = 'Offline';
      const isWorking   = lastLog && (lastLog.type === 'login' || lastLog.type === 'lunch_out' || lastLog.type === 'break_end' || lastLog.type === 'idle_end' || lastLog.type === 'location_update');
      const isOnBreak   = lastLog && (lastLog.type === 'lunch_in' || lastLog.type === 'break_start');
      if (uLogs.length === 0) status = 'Absent';
      else if (isWorking)     status = hours >= 9 ? 'Overtime' : 'Working';
      else if (isOnBreak)     status = 'On Break';
      return { ...user, status, latestReport, workingHours: `${hours}h ${minutes}m`, rawHours: hours + minutes / 60 };
    });
  }, [data]);

  const filteredUsers = getUsersWithCalculatedData.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || u.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleDateClick = (date: Date) => { setSelectedDate(date); setIsModalOpen(true); };

  const analytics = useMemo(() => {
    const todayStr      = format(new Date(), 'yyyy-MM-dd');
    const todayLogs     = data.logs.filter(l => format(new Date(l.timestamp), 'yyyy-MM-dd') === todayStr);
    const totalEmployees = data.users.filter(u => u.role === 'user').length;
    let punchedInCount = 0, totalWorkMinutesToday = 0, presentTodayCount = 0;
    data.users.filter(u => u.role === 'user').forEach(user => {
      const uLogs = todayLogs.filter(l => l.userId === user.id);
      if (uLogs.length > 0) {
        if (uLogs.some(l => l.type === 'login')) presentTodayCount++;
        const { totalMinutes } = calculateTotalHours(uLogs);
        totalWorkMinutesToday += totalMinutes;
        const lastLog = [...uLogs].reverse().find((l: any) => l.type !== 'daily_report');
        if (lastLog && (lastLog.type === 'login' || lastLog.type === 'lunch_out' || lastLog.type === 'break_end')) punchedInCount++;
      }
    });
    return {
      totalEmployees,
      presentToday:        presentTodayCount,
      absentToday:         Math.max(0, totalEmployees - presentTodayCount),
      currentlyPunchedIn:  punchedInCount,
      utilizationPercent:  totalEmployees > 0 ? Math.round((presentTodayCount / totalEmployees) * 100) : 0,
    };
  }, [data]);

  return (
    <DashboardLayout title="Admin Dashboard">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 px-1">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            Workforce Attendance
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-semibold uppercase tracking-wider border border-indigo-100/50">
              <div className="w-1 h-1 bg-indigo-500 rounded-full" />
              Auto Refresh
            </span>
          </h2>
          <p className="text-gray-500 text-sm mt-1">Monitor daily workforce attendance logs and real-time status.</p>
        </div>
        <DatePicker value={format(new Date(), 'yyyy-MM-dd')} onChange={() => {}} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8 pb-2 border-b border-gray-200/50">
        <StatCard title="Total Employees" value={analytics.totalEmployees} subtitle="Registered workforce" icon={Users} color="blue" />
        <StatCard title="Today Present"   value={analytics.presentToday}   subtitle="Employees on duty"   icon={CheckCircle} color="green"
          trend={Math.round((analytics.presentToday / (analytics.totalEmployees || 1)) * 100)} />
        <StatCard title="Today Absent"    value={analytics.absentToday}    subtitle="Employees off duty"  icon={X} color="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
        <Card className="xl:col-span-2 p-6 border border-gray-200/80 shadow-sm bg-white">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h4 className="text-base font-bold text-gray-900">Company Attendance Calendar</h4>
              <p className="text-sm text-gray-500 mt-1">Select a date to view the full attendance log.</p>
            </div>
            <div className="bg-gray-50 text-gray-500 p-2 rounded-lg border border-gray-200"><Calendar size={18} /></div>
          </div>
          <AdminAttendanceCalendar logs={data.logs} users={data.users} onDateClick={handleDateClick} />
        </Card>
        <div className="space-y-6" />
      </div>

      <div className="mb-8 flex flex-col xl:flex-row gap-4 justify-between items-stretch xl:items-center">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search employees by name or email..."
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm text-sm"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 xl:pb-0">
          {['All', 'Working', 'On Break', 'Overtime', 'Offline', 'Absent'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${statusFilter === s ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-200 hover:text-indigo-600'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden border border-gray-200/80 shadow-sm bg-white rounded-xl">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100/50"><Users size={18} /></div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Real-Time Activity Logger</h3>
              <p className="text-xs text-gray-500 mt-0.5">Active statuses of all registered employees</p>
            </div>
          </div>
          <span className="text-xs text-gray-400 font-medium">Updates every 10s</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[800px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Employee</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Today's Report</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Working Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredUsers.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-20 text-center text-gray-400 text-sm">No matching employees found</td></tr>
              ) : filteredUsers.map(user => (
                <tr key={user.id} className="hover:bg-gray-50/50 transition-all group h-16">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-indigo-50 text-indigo-700 rounded-lg flex items-center justify-center font-bold group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm border border-indigo-100/50 flex-shrink-0">
                        {user.name.charAt(0)}
                      </div>
                      <div className="truncate">
                        <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
                        <p className="text-xs text-gray-400 truncate">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3"><StatusBadge status={user.status} /></td>
                  <td className="px-6 py-3">
                    <p className={`text-sm font-medium max-w-xs truncate ${user.latestReport === 'No report submitted' ? 'text-gray-300 italic' : 'text-gray-600'}`}>
                      {user.latestReport}
                    </p>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-gray-50 text-gray-400 rounded-lg border border-gray-100"><Briefcase size={14} /></div>
                      <span className="text-sm font-bold text-gray-700">{user.workingHours}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DayAttendanceModal date={selectedDate || new Date()} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} token={token} />
    </DashboardLayout>
  );
};

const AdminUsersPage = () => {
  const { token } = useAuth();
  const [users, setUsers] = useState<UserType[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserType | null>(null);

  const fetchUsers = async () => {
    const res = await apiFetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const json = await res.json();
    setUsers(Array.isArray(json) ? json : []);
  };

  useEffect(() => { fetchUsers(); }, [token]);

  const filteredUsers = users.filter(u =>
    !u.isDeleted && (u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <DashboardLayout title="Employee Registry" showBack>
      <div className="mb-8 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center px-1">
        <div className="relative w-full max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input type="text" placeholder="Search employees..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant="primary" icon={User} onClick={() => setIsModalOpen(true)}>Add Employee</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers.map(user => (
          <Card key={user.id} className="p-6 bg-white border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all group relative overflow-hidden rounded-xl shadow-sm">
            <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => { setSelectedUser(user); setIsDeleteModalOpen(true); }} className="text-gray-300 hover:text-red-500 transition-colors">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-700 rounded-lg flex items-center justify-center text-lg font-bold border border-indigo-100/60 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-all shadow-sm">
                {user.name.charAt(0)}
              </div>
              <div className="overflow-hidden">
                <h4 className="font-bold text-gray-900 truncate text-base tracking-tight">{user.name}</h4>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{user.role}</p>
                  {user.status === 'inactive' && (
                    <span className="text-[10px] font-semibold bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded border border-rose-100">Inactive</span>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <MessageSquare size={14} className="text-gray-400" />
                <span className="truncate">{user.email}</span>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-4">
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide bg-indigo-50/50 border border-indigo-100/50 px-2 py-0.5 rounded">DEPT: {user.department || 'OPS'}</span>
                <button onClick={() => { setSelectedUser(user); setIsEditModalOpen(true); }}
                  className="text-xs font-semibold text-gray-500 hover:text-indigo-600 hover:underline transition-colors">
                  Edit Profile
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <AddEmployeeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} token={token} onRefresh={fetchUsers} />
      <EditEmployeeModal user={selectedUser} isOpen={isEditModalOpen} onClose={() => { setIsEditModalOpen(false); setSelectedUser(null); }} token={token} onRefresh={fetchUsers} />
      <DeleteConfirmationModal user={selectedUser} isOpen={isDeleteModalOpen} onClose={() => { setIsDeleteModalOpen(false); setSelectedUser(null); }} token={token} onRefresh={fetchUsers} />
    </DashboardLayout>
  );
};

const AdminMonthlyReport = () => {
  const { token } = useAuth();
  const [allUsers, setAllUsers] = useState<UserType[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const res = await apiFetch('/api/admin/data', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { setLoading(false); return; }
      const json = await res.json();
      setAllUsers(Array.isArray(json.users) ? json.users : []);
      setAllLogs(Array.isArray(json.logs) ? json.logs : []);
      setLoading(false);
    };
    fetchData();
  }, [token]);

  const TARGET_HOURS = 168; // 8h × 21 working days

  const monthlyData = allUsers
    .filter(u => !u.isDeleted && u.role === 'user')
    .map(u => {
      const monthLogs = allLogs.filter(l => {
        if (l.userId !== u.id) return false;
        return l.timestamp.startsWith(selectedMonth);
      });
      const { totalMinutes } = calculateTotalHours(monthLogs);
      const hoursWorked = Math.floor(totalMinutes / 60);
      const minsWorked = totalMinutes % 60;
      const totalHoursDecimal = totalMinutes / 60;
      const varianceHours = totalHoursDecimal - TARGET_HOURS;
      const pct = Math.min(100, Math.round((totalHoursDecimal / TARGET_HOURS) * 100));
      return { user: u, hoursWorked, minsWorked, totalMinutes, varianceHours, pct };
    });

  const monthOptions: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    monthOptions.push(format(d, 'yyyy-MM'));
  }

  const handleDownload = () => {
    const headers = ['Employee', 'Email', 'Department', 'Hours Worked', 'Target (168h)', 'Variance', 'Completion %', 'Status', 'Month'];
    const rows = monthlyData.map(r => [
      r.user.name,
      r.user.email,
      r.user.department || 'N/A',
      `${r.hoursWorked}h ${r.minsWorked}m`,
      '168h 0m',
      `${r.varianceHours >= 0 ? '+' : ''}${r.varianceHours.toFixed(1)}h`,
      `${r.pct}%`,
      r.totalMinutes >= TARGET_HOURS * 60 ? 'Met' : `Short by ${Math.ceil(TARGET_HOURS - r.totalMinutes / 60)}h`,
      selectedMonth,
    ]);
    const csvContent = [headers, ...rows].map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `monthly-report-${selectedMonth}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <DashboardLayout title="Monthly Hours Report" showBack>
      <div className="mb-6 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center px-1">
        <div>
          <p className="text-sm text-gray-500 mt-1">Target: <span className="font-semibold text-gray-700">168 hours</span> per employee (8h × 21 working days)</p>
        </div>
        <div className="flex gap-3 items-center">
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{format(new Date(m + '-01'), 'MMMM yyyy')}</option>
            ))}
          </select>
          <Button variant="primary" icon={Download} onClick={handleDownload}>Download CSV</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {(() => {
              const total = monthlyData.length;
              const met = monthlyData.filter(r => r.totalMinutes >= TARGET_HOURS * 60).length;
              const short = total - met;
              const avgPct = total > 0 ? Math.round(monthlyData.reduce((s, r) => s + r.pct, 0) / total) : 0;
              return (
                <>
                  <Card className="p-5 bg-white rounded-2xl border border-gray-100 shadow-sm text-center">
                    <div className="text-3xl font-extrabold text-gray-800">{total}</div>
                    <div className="text-xs font-medium text-gray-500 mt-1 uppercase tracking-wide">Employees</div>
                  </Card>
                  <Card className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100 shadow-sm text-center">
                    <div className="text-3xl font-extrabold text-emerald-600">{met}</div>
                    <div className="text-xs font-medium text-emerald-600 mt-1 uppercase tracking-wide">Met Target</div>
                  </Card>
                  <Card className="p-5 bg-rose-50 rounded-2xl border border-rose-100 shadow-sm text-center">
                    <div className="text-3xl font-extrabold text-rose-500">{short}</div>
                    <div className="text-xs font-medium text-rose-500 mt-1 uppercase tracking-wide">Below Target</div>
                  </Card>
                  <Card className="p-5 bg-indigo-50 rounded-2xl border border-indigo-100 shadow-sm text-center">
                    <div className="text-3xl font-extrabold text-indigo-600">{avgPct}%</div>
                    <div className="text-xs font-medium text-indigo-500 mt-1 uppercase tracking-wide">Avg Completion</div>
                  </Card>
                </>
              );
            })()}
          </div>

          {/* Table */}
          <Card className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Department</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Hours Worked</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Target</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Variance</th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Progress</th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {monthlyData.length === 0 ? (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No employee data for this month.</td></tr>
                  ) : monthlyData.map(r => {
                    const met = r.totalMinutes >= TARGET_HOURS * 60;
                    const shortHrs = Math.ceil(TARGET_HOURS - r.totalMinutes / 60);
                    return (
                      <tr key={r.user.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-sm border border-indigo-100">
                              {r.user.name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-800">{r.user.name}</div>
                              <div className="text-xs text-gray-400">{r.user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-500">{r.user.department || '—'}</td>
                        <td className="px-6 py-4 text-right font-semibold text-gray-800">{r.hoursWorked}h {r.minsWorked}m</td>
                        <td className="px-6 py-4 text-right text-gray-500">168h</td>
                        <td className={`px-6 py-4 text-right font-semibold ${r.varianceHours >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {r.varianceHours >= 0 ? '+' : ''}{r.varianceHours.toFixed(1)}h
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-[80px]">
                              <div
                                className={`h-2 rounded-full transition-all ${met ? 'bg-emerald-500' : 'bg-indigo-400'}`}
                                style={{ width: `${r.pct}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-gray-500 w-10 text-right">{r.pct}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {met ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ✅ Met
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200">
                              ⚠️ Short {shortHrs}h
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </DashboardLayout>
  );
};

const ReportsPage = () => {
    const { token, user } = useAuth();
    const [logs, setLogs] = useState<TimeLog[]>([]);
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [reportNote, setReportNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const fetchLogs = async () => {
        const res = await apiFetch('/api/logs', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : []);
    };

    useEffect(() => { fetchLogs(); }, [token]);

    const changeDate = (days: number) => {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        setDate(format(d, 'yyyy-MM-dd'));
    };

    const handleSaveReport = async () => {
        if (!reportNote.trim()) return;
        setSaving(true);
        try {
            await apiFetch('/api/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ type: 'daily_report', note: reportNote, location: null }),
            });
            setReportNote('');
            fetchLogs();
        } catch (err) { console.error(err); }
        finally { setSaving(false); }
    };

    const filteredLogs = logs.filter(l => format(new Date(l.timestamp), 'yyyy-MM-dd') === date);

    return (
        <DashboardLayout title="Daily Performance Report" showBack>
            <div className="mb-8 flex flex-col xl:flex-row gap-6 items-start xl:items-center justify-between">
                <div className="flex flex-col sm:flex-row gap-4 items-center w-full xl:w-auto">
                    <div className="flex items-center bg-white border border-gray-200 rounded-2xl shadow-sm w-full sm:w-auto">
                        <button onClick={() => changeDate(-1)} className="p-3 hover:bg-gray-50 text-gray-400 hover:text-indigo-600 border-r border-gray-100 transition-colors"><ChevronLeft size={20} /></button>
                        <DatePicker value={date} onChange={setDate} />
                        <button onClick={() => changeDate(1)} className="p-3 hover:bg-gray-50 text-gray-400 hover:text-indigo-600 border-l border-gray-100 transition-colors"><ChevronRight size={20} /></button>
                    </div>
                    <Card className="px-5 py-2 flex items-center gap-3 bg-indigo-50 border-indigo-100 w-full sm:w-auto shadow-sm">
                        <Briefcase size={18} className="text-indigo-600" />
                        <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">Active Hours</p>
                            <p className="text-sm font-black text-indigo-700">
                                {(() => { const { hours, minutes } = calculateTotalHours(filteredLogs.filter(l => l.type !== 'daily_report')); return `${hours}h ${minutes}m`; })()}
                            </p>
                        </div>
                    </Card>
                </div>
                <Button variant="secondary" icon={Download} className="w-full sm:w-auto px-6 rounded-xl"
                    onClick={() => exportToCSV(filteredLogs, `${user?.name}_report`)}>Export CSV</Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card className="overflow-hidden shadow-sm border-gray-100">
                        <div className="p-6 border-b border-gray-100 bg-gray-50/20">
                            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
                                <MessageSquare size={20} className="text-indigo-600" />
                                Activity Detail Logs
                            </h3>
                        </div>
                        <div className="overflow-x-auto min-h-[300px]">
                            <table className="w-full text-left">
                                <thead className="bg-white border-b border-gray-100">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Event</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Time</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Note</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 bg-white">
                                    {filteredLogs.filter(l => l.type !== 'daily_report').length === 0 ? (
                                        <tr><td colSpan={3} className="px-6 py-24 text-center text-gray-300 font-bold uppercase tracking-widest text-xs">No records for this date</td></tr>
                                    ) : filteredLogs.filter(l => l.type !== 'daily_report').map(log => (
                                        <tr key={log.id} className="hover:bg-indigo-50/10 transition-colors">
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2.5 h-2.5 rounded-full ${log.type === 'login' ? 'bg-emerald-500' : log.type === 'logout' ? 'bg-red-500' : 'bg-amber-400'}`} />
                                                    <span className="capitalize font-bold text-gray-900 text-sm">{(LOG_LABELS[log.type] || log.type)}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-sm font-bold text-gray-500">{format(new Date(log.timestamp), 'h:mm:ss aa')}</td>
                                            <td className="px-6 py-5">
                                                <p className="text-sm text-gray-600 italic font-medium">
                                                    {log.note ? `"${log.note}"` : <span className="text-gray-300">—</span>}
                                                </p>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Daily Report Summary</h4>
                        <textarea
                            className="w-full p-4 border border-gray-100 rounded-xl bg-gray-50 text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-h-[150px] resize-none"
                            placeholder="Write your final report for the day here..."
                            value={reportNote} onChange={e => setReportNote(e.target.value)}
                        />
                        <Button className="w-full mt-4 h-12" onClick={handleSaveReport} disabled={saving || !reportNote.trim()}>
                            {saving ? 'Saving...' : 'Submit Report'}
                        </Button>
                    </Card>

                    <Card className="p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Submitted Reports</h4>
                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                            {filteredLogs.filter(l => l.type === 'daily_report').length === 0 ? (
                                <p className="text-xs text-gray-400 italic text-center py-8">No reports written today</p>
                            ) : filteredLogs.filter(l => l.type === 'daily_report').map(log => (
                                <div key={log.id} className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 shadow-sm">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{format(new Date(log.timestamp), 'hh:mm a')}</span>
                                        <div className="p-1 bg-white rounded-md"><FileText size={12} className="text-indigo-600" /></div>
                                    </div>
                                    <p className="text-xs text-gray-700 leading-relaxed font-medium">{log.note}</p>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
};

// --- App Root ---

export default function App() {
  const [user, setUser] = useState<UserType | null>(() => {
    const saved = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    return (saved && token) ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));

  const login = (data: any) => {
    setUser(data.user);
    setToken(data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('token', data.token);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  };

  const loginDest = user
    ? user.role === 'admin' ? '/admin' : user.role === 'teamlead' ? '/teamlead' : '/dashboard'
    : undefined;

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"
            element={user && loginDest ? <Navigate to={loginDest} replace /> : <LoginPage />} />
          <Route path="/admin/login"
            element={user ? <Navigate to="/admin" replace /> : <LoginPage isAdmin />} />
          <Route path="/register"
            element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />

          {/* Employee routes */}
          <Route path="/dashboard"
            element={user && user.role === 'user' ? <UserDashboard /> : <Navigate to="/login" replace />} />
          <Route path="/reports"
            element={user && user.role === 'user' ? <ReportsPage /> : <Navigate to="/login" replace />} />

          {/* Team Lead routes */}
          <Route path="/teamlead"
            element={user && user.role === 'teamlead' ? <TeamLeadDashboard /> : <Navigate to="/login" replace />} />

          {/* Admin routes */}
          <Route path="/admin"
            element={user && user.role === 'admin' ? <AdminDashboard /> : <Navigate to="/admin/login" replace />} />
          <Route path="/admin/users"
            element={user && user.role === 'admin' ? <AdminUsersPage /> : <Navigate to="/admin/login" replace />} />
          <Route path="/admin/monthly"
            element={user && user.role === 'admin' ? <AdminMonthlyReport /> : <Navigate to="/admin/login" replace />} />

          <Route path="/" element={<LandingPage />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
