import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Travel CRM stages
    inquiry_received: '#6366F1',
    initial_contact: '#8B5CF6',
    options_shared: '#3B82F6',
    consultation_booked: '#06B6D4',
    itinerary_sent: '#F59E0B',
    follow_up: '#F97316',
    customizing_package: '#EC4899',
    booking_confirmed: '#22C55E',
    booking_lost: '#EF4444',
    // Backward-compatible SaaS aliases
    new: '#6366F1',
    contacted: '#8B5CF6',
    interested: '#3B82F6',
    demo_scheduled: '#06B6D4',
    proposal_sent: '#F59E0B',
    negotiation: '#EC4899',
    closed_won: '#22C55E',
    closed_lost: '#EF4444',
  };
  return colors[status] || '#71717A';
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    // Travel CRM stages
    inquiry_received: 'Inquiry Received',
    initial_contact: 'Initial Contact',
    options_shared: 'Options Shared',
    consultation_booked: 'Consultation Booked',
    itinerary_sent: 'Itinerary Sent',
    follow_up: 'Follow-Up',
    customizing_package: 'Customizing Package',
    booking_confirmed: 'Booking Confirmed',
    booking_lost: 'Booking Lost',
    // Backward-compatible SaaS aliases
    new: 'Inquiry Received',
    contacted: 'Initial Contact',
    interested: 'Options Shared',
    demo_scheduled: 'Consultation Booked',
    proposal_sent: 'Itinerary Sent',
    negotiation: 'Customizing Package',
    closed_won: 'Booking Confirmed',
    closed_lost: 'Booking Lost',
  };
  return labels[status] || status;
}

export function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    low: '#71717A',
    medium: '#3B82F6',
    high: '#F59E0B',
    urgent: '#EF4444',
  };
  return colors[priority] || '#71717A';
}

export function getPriorityColorClass(priority: string): string {
  const classes: Record<string, string> = {
    low: 'bg-gray-100 text-gray-600 border-gray-200',
    medium: 'bg-blue-100 text-blue-700 border-blue-200',
    high: 'bg-amber-100 text-amber-700 border-amber-200',
    urgent: 'bg-red-100 text-red-700 border-red-200',
  };
  return classes[priority] || classes.medium;
}
