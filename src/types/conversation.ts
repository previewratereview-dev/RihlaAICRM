export type MessageType = 'text' | 'image' | 'file' | 'voice' | 'template';
export type SenderType = 'user' | 'contact' | 'system';
export type ConversationStatus = 'open' | 'closed' | 'archived';
export type Channel = 'whatsapp' | 'email' | 'sms';

export interface Message {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  content: string;
  messageType: MessageType;
  mediaUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  leadId: string;
  leadName: string;
  leadAvatar: string;
  leadCompany: string;
  leadEmail?: string;
  channel: Channel;
  assignedTo: string;
  assignedName: string;
  status: ConversationStatus;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  isOnline: boolean;
  phone: string;
}
