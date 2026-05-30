export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'user' | 'admin' | 'teamlead';
  department?: string;
  employeeId?: string;
  shiftTiming?: string;
  joiningDate?: string;
  profileImage?: string;
  status?: 'active' | 'inactive';
  isDeleted?: boolean;
}

export interface TimeLog {
  id: string;
  userId: string;
  type: 'login' | 'lunch_in' | 'lunch_out' | 'logout' | 'daily_report' | 'break_start' | 'break_end';
  timestamp: string;
  note?: string;
  location: {
    lat: number;
    lng: number;
  } | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  assignedByName?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  createdAt: string;
  updatedAt?: string;
  groupId?: string | null;
  groupName?: string | null;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  color: string;
  createdBy: string;
  createdAt: string;
  memberIds: string[];
}

export interface AuthResponse {
  token: string;
  user: User;
}
