export const APP_NAME = 'WanderBot AI';
export const APP_TAGLINE = 'Your Intelligent Travel Concierge';
export const APP_DESCRIPTION = 'The Next-Gen Travel Booking & Management Platform';
export const ACCENT_COLOR = '#FF6B35';
export const ACCENT_COLOR_LIGHT = '#FF8C5A';
export const ACCENT_COLOR_DARK = '#E85A24';

export const LEAD_STATUS_OPTIONS = [
  { label: 'Inquiry Received', value: 'inquiry_received' },
  { label: 'Initial Contact', value: 'initial_contact' },
  { label: 'Options Shared', value: 'options_shared' },
  { label: 'Consultation Booked', value: 'consultation_booked' },
  { label: 'Itinerary Sent', value: 'itinerary_sent' },
  { label: 'Follow-Up', value: 'follow_up' },
  { label: 'Customizing Package', value: 'customizing_package' },
  { label: 'Booking Confirmed', value: 'booking_confirmed' },
  { label: 'Booking Lost', value: 'booking_lost' },
] as const;

export const LEAD_SOURCE_OPTIONS = [
  { label: 'Website', value: 'website' },
  { label: 'Walk-In', value: 'walk_in' },
  { label: 'Referral', value: 'referral' },
  { label: 'Phone Inquiry', value: 'phone_inquiry' },
  { label: 'Email Inquiry', value: 'email_inquiry' },
  { label: 'Travel Agent', value: 'travel_agent' },
  { label: 'Hotel Chain Partner', value: 'hotel_partner' },
  { label: 'Corporate', value: 'corporate' },
  { label: 'Travel Expo', value: 'travel_expo' },
  { label: 'Social Media', value: 'social_media' },
  { label: 'Other', value: 'other' },
] as const;

export const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
] as const;

export const TASK_TYPE_OPTIONS = [
  { label: 'Follow-Up Call', value: 'follow_up_call' },
  { label: 'Consultation', value: 'consultation' },
  { label: 'Booking Confirmation', value: 'booking_confirmation' },
  { label: 'Itinerary Review', value: 'itinerary_review' },
  { label: 'Payment Follow-Up', value: 'payment_follow_up' },
  { label: 'Travel Document Check', value: 'travel_document_check' },
  { label: 'Pre-Trip Briefing', value: 'pre_trip_briefing' },
  { label: 'Other', value: 'other' },
] as const;

export const ROLE_OPTIONS = [
  { label: 'Admin', value: 'admin' },
  { label: 'Travel Consultant', value: 'consultant' },
  { label: 'Booking Manager', value: 'manager' },
  { label: 'Travel Specialist', value: 'specialist' },
  { label: 'Team Member', value: 'member' },
] as const;

export const INDUSTRY_OPTIONS = [
  'Adventure Travel',
  'Luxury Travel',
  'Honeymoon',
  'Family Vacation',
  'Group Tour',
  'Corporate Retreat',
  'Safari',
  'Beach Holiday',
  'Cultural Tour',
  'Wellness & Spa',
  'Cruise',
  'Other',
] as const;

export const TRAVEL_CLASS_OPTIONS = [
  { label: 'Economy', value: 'economy' },
  { label: 'Premium Economy', value: 'premium_economy' },
  { label: 'Business', value: 'business' },
  { label: 'First Class', value: 'first_class' },
  { label: 'Private Jet', value: 'private_jet' },
] as const;

export const TRIP_TYPE_OPTIONS = [
  { label: 'Adventure', value: 'adventure' },
  { label: 'Luxury', value: 'luxury' },
  { label: 'Honeymoon', value: 'honeymoon' },
  { label: 'Family', value: 'family' },
  { label: 'Group', value: 'group' },
  { label: 'Corporate', value: 'corporate' },
  { label: 'Solo', value: 'solo' },
  { label: 'Backpacking', value: 'backpacking' },
] as const;

export const DESTINATION_TYPE_OPTIONS = [
  'Domestic',
  'International',
  'Regional',
  'Cross-Country',
] as const;
