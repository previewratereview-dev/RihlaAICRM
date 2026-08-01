import { z } from 'zod';

export const leadSchema = z.object({
  fullName: z.string().min(1, 'Name is required').max(200),
  businessName: z.string().min(1, 'Business name is required').max(200),
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  phone: z.string().max(30),
  whatsapp: z.string().max(30),
  leadSource: z.string(),
  tripType: z.string(),
  destination: z.string().max(200),
  country: z.string(),
  city: z.string().max(100),
  numberOfTravelers: z.string(),
  departureDate: z.string(),
  returnDate: z.string(),
  duration: z.string(),
  travelClass: z.string(),
  budget: z.string(),
  dealValue: z.coerce.number().min(0),
  status: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assignedTo: z.string().min(1, 'Assignee is required'),
  tags: z.array(z.string()),
  specialRequests: z.string(),
  sourceOfDiscovery: z.string(),
  lastContacted: z.string(),
  nextFollowUp: z.string(),
  website: z.string(),
  industry: z.string(),
  linkedin: z.string(),
  instagram: z.string(),
  employeeCount: z.string(),
  monthlyRevenue: z.string(),
  currentSoftware: z.string(),
  interestedService: z.string(),
  painPoints: z.string(),
});

export type LeadFormData = z.infer<typeof leadSchema>;

export const LEAD_DEFAULTS: LeadFormData = {
  fullName: '',
  email: '',
  phone: '',
  whatsapp: '',
  leadSource: 'website',
  tripType: 'Family Vacation',
  destination: '',
  country: 'United States',
  city: '',
  numberOfTravelers: '1',
  departureDate: '',
  returnDate: '',
  duration: '7 Days / 6 Nights',
  travelClass: 'economy',
  budget: '₹5,000',
  dealValue: 5000,
  status: 'inquiry_received',
  priority: 'medium',
  assignedTo: '',
  tags: [],
  specialRequests: '',
  sourceOfDiscovery: '',
  lastContacted: '',
  nextFollowUp: '',
  businessName: '',
  website: '',
  industry: '',
  linkedin: '',
  instagram: '',
  employeeCount: '1-10',
  monthlyRevenue: '₹100K',
  currentSoftware: '',
  interestedService: '',
  painPoints: '',
};

export const taskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000),
  type: z.enum(['follow_up', 'call', 'meeting', 'email', 'demo', 'proposal', 'other']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  dueDate: z.string().min(1, 'Due date is required'),
  leadId: z.string(),
  assignedTo: z.string().min(1, 'Assignee is required'),
});

export type TaskFormData = z.infer<typeof taskSchema>;

export const TASK_DEFAULTS: TaskFormData = {
  title: '',
  description: '',
  type: 'follow_up',
  priority: 'medium',
  dueDate: '',
  leadId: '',
  assignedTo: '',
};

export const meetingSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000),
  leadId: z.string(),
  dueDate: z.string().min(1, 'Date is required'),
  dueTime: z.string().min(1, 'Time is required'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assignedTo: z.string().min(1, 'Assignee is required'),
});

export type MeetingFormData = z.infer<typeof meetingSchema>;

export const teamMemberSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(200),
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  role: z.enum(['admin', 'manager', 'specialist', 'consultant']),
  password: z.string().min(6, 'Password must be at least 6 characters').or(z.literal('')),
  isOnline: z.boolean(),
});

export type TeamMemberFormData = z.infer<typeof teamMemberSchema>;

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const noteSchema = z.object({
  content: z.string().min(1, 'Note cannot be empty').max(5000),
});

export type NoteFormData = z.infer<typeof noteSchema>;
