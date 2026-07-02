import { Priority } from './common';

export type TaskType = 'follow_up' | 'call' | 'meeting' | 'email' | 'demo' | 'proposal' | 'other';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';

export interface TaskUpdate {
  authorName: string;
  note: string;
  timestamp: string;
  statusChange?: string;
}

export interface Task {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  dueDate: string;
  completedAt?: string;
  leadId?: string;
  leadName?: string;
  assignedTo: string;
  assignedName: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  
  // Meeting Management Upgrades
  meetingType?: 'demo' | 'discovery' | 'consultation' | 'follow_up';
  meetingOutcome?: 'Interested' | 'Follow-up Required' | 'Proposal Sent' | 'Not Interested' | 'No Show' | 'Closed Won' | 'Closed Lost' | 'pending';
  googleMeetLink?: string;
  meetingNotes?: string;
  updates?: TaskUpdate[];
}

export interface CreateTaskDTO {
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  dueDate: string;
  leadId?: string;
  leadName?: string;
  assignedTo: string;
  assignedName: string;
}
