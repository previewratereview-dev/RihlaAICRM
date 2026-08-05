'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Paperclip, Search, Phone, Video, Bot, Sparkles, FileText, Pencil, Trash2, Check, X } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { useChatbot } from '@/hooks/use-chatbot';
import { getInitials, formatRelativeTime } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export function ConversationsView() {
  const conversations = useCRMStore((state) => state.conversations);
  const messages = useCRMStore((state) => state.messages);
  const typingState = useCRMStore((state) => state.typingState);
  const currentUser = useCRMStore((state) => state.currentUser);
  const sendMessage = useCRMStore((state) => state.sendMessage);
  const editMessage = useCRMStore((state) => state.editMessage);
  const deleteMessage = useCRMStore((state) => state.deleteMessage);
  const clearUnreadCount = useCRMStore((state) => state.clearUnreadCount);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const {
    messages: aiMessages,
    sendMessage: sendAiMessage,
    isTyping: aiIsTyping,
  } = useChatbot();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [threadSummary, setThreadSummary] = useState<string | null>(null);
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiEndRef = useRef<HTMLDivElement>(null);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const matchesSearch =
          c.leadName.toLowerCase().includes(q) ||
          c.leadCompany.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q) ||
          c.phone.includes(q);
        if (!matchesSearch) return false;
      }
      if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
      if (unreadOnly && c.unreadCount === 0) return false;
      return true;
    });
  }, [conversations, searchQuery, channelFilter, unreadOnly]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const threadMessages = useMemo(() => {
    return selectedId ? messages[selectedId] ?? [] : [];
  }, [messages, selectedId]);
  const isContactTyping = selectedId ? !!typingState[selectedId] : false;

  const latestQuickReplies = useMemo(() => {
    for (let i = aiMessages.length - 1; i >= 0; i--) {
      const msg = aiMessages[i];
      if (msg.role === 'assistant' && msg.quickReplies?.length) {
        return msg.quickReplies;
      }
    }
    return [];
  }, [aiMessages]);

  // Auto-select first conversation
  useEffect(() => {
    if (filteredConversations.length > 0 && !selectedId) {
      const firstId = filteredConversations[0].id;
      Promise.resolve().then(() => {
        setSelectedId(firstId);
      });
    }
  }, [filteredConversations, selectedId]);

  useEffect(() => {
    const el = messagesEndRef.current?.parentElement;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [threadMessages, isContactTyping]);

  useEffect(() => {
    const el = aiEndRef.current?.parentElement;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [aiMessages, aiIsTyping]);

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    clearUnreadCount(id);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = messageInput.trim();
    if (!content || !selectedId || !currentUser) return;

    setMessageInput('');
    await sendMessage(
      selectedId,
      content,
      'user',
      currentUser.id,
      currentUser.fullName
    );
  };

  const handleSendAiMessage = async (text?: string) => {
    const content = (text ?? aiInput).trim();
    if (!content) return;
    setAiInput('');
    await sendAiMessage(content);
  };

  const callConversationAI = async (action: 'summarize' | 'suggest_replies') => {
    if (!threadMessages.length) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          messages: threadMessages.map((m) => ({
            sender: m.senderType,
            content: m.content,
          })),
        }),
      });
      const data = await res.json();
      if (action === 'summarize') {
        setThreadSummary(data.content || null);
      } else {
        const lines = String(data.content || '')
          .split('\n')
          .map((l: string) => l.replace(/^\d+[\).\s]+/, '').trim())
          .filter(Boolean);
        setSuggestedReplies(lines.slice(0, 3));
      }
    } finally {
      setAiLoading(false);
    }
  };

  const handleOutbound = async (channel: 'whatsapp' | 'sms' | 'email') => {
    if (!selectedConversation || !messageInput.trim()) return;
    const content = messageInput.trim();
    setMessageInput('');
    await fetch('/api/messaging/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        conversationId: selectedConversation.id,
        to: channel === 'email' ? (selectedConversation.leadEmail || selectedConversation.leadCompany) : selectedConversation.phone,
        content,
        leadName: selectedConversation.leadName,
      }),
    });
    if (currentUser) {
      await sendMessage(selectedId!, content, 'user', currentUser.id, currentUser.fullName);
    }
  };

  const dataLoading = useCRMStore((state) => state.dataLoading);

  if (dataLoading && conversations.length === 0) {
    return (
      <div className="h-full w-full flex">
        <div className="w-80 border-r border-border/60 bg-card/50 p-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden flex">
      {/* Conversations List */}
      <div className="w-80 border-r border-border/60 bg-card/50 flex flex-col shrink-0">
        <div className="p-4 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground font-heading mb-3">Messages</h2>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-xl bg-background border border-input text-sm focus:outline-none focus:border-primary"
              aria-label="Search conversations"
            />
          </div>
          <div className="flex items-center gap-2 mt-3">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs focus:outline-none focus:border-primary"
              aria-label="Filter by channel"
            >
              <option value="all">All Channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
            <button
              type="button"
              onClick={() => setUnreadOnly(!unreadOnly)}
              className={`h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors ${
                unreadOnly
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-background border-input text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={unreadOnly}
              aria-label="Toggle unread filter"
            >
              Unread
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredConversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {searchQuery ? 'No conversations match your search.' : 'No conversations yet.'}
            </p>
          ) : (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => handleSelectConversation(conv.id)}
                className={`w-full text-left p-3 rounded-xl cursor-pointer transition-colors ${
                  selectedId === conv.id
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary/50 border border-transparent'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-white text-xs font-bold">
                      {getInitials(conv.leadName)}
                    </div>
                    {conv.isOnline && (
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {conv.leadName}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0 ml-2">
                        {formatRelativeTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{conv.lastMessage}</p>
                  </div>
                  {conv.unreadCount > 0 && (
                    <div className="h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center mt-1 shrink-0">
                      {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-background/30 min-w-0">
        {selectedConversation ? (
          <>
            <div className="p-4 border-b border-border/60 bg-card/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-white text-xs font-bold">
                    {getInitials(selectedConversation.leadName)}
                  </div>
                  {selectedConversation.isOnline && (
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm">
                    {selectedConversation.leadName}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {isContactTyping
                      ? 'Typing...'
                      : selectedConversation.isOnline
                        ? 'Active now'
                        : selectedConversation.leadCompany || selectedConversation.channel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedConversation.phone && (
                  <a
                    href={`tel:${selectedConversation.phone}`}
                    className="p-2 rounded-xl hover:bg-secondary text-muted-foreground transition-colors"
                    aria-label="Call"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  className="p-2 rounded-xl hover:bg-secondary text-muted-foreground transition-colors"
                  aria-label="Start video call"
                >
                  <Video className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => callConversationAI('summarize')}
                  disabled={aiLoading || !threadMessages.length}
                  className="p-2 rounded-xl hover:bg-secondary text-muted-foreground transition-colors"
                  title="Summarize thread"
                  aria-label="Summarize thread"
                >
                  <FileText className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => callConversationAI('suggest_replies')}
                  disabled={aiLoading || !threadMessages.length}
                  className="p-2 rounded-xl hover:bg-secondary text-muted-foreground transition-colors"
                  title="Suggest replies"
                  aria-label="Suggest replies"
                >
                  <Sparkles className="h-4 w-4" />
                </button>
              </div>
            </div>

            {threadSummary && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm text-foreground">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">AI Summary</p>
                <p className="whitespace-pre-wrap">{threadSummary}</p>
              </div>
            )}

            {suggestedReplies.length > 0 && (
              <div className="mx-6 mt-3 flex flex-wrap gap-2">
                {suggestedReplies.map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    onClick={() => setMessageInput(reply)}
                    className="text-xs px-3 py-1.5 rounded-full bg-secondary hover:bg-secondary/80 transition-colors"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {threadMessages.map((msg, i) => {
                const isOutgoing = msg.senderType === 'user';
                const isSystem = msg.senderType === 'system';

                if (isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <span className="text-[10px] text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full">
                        {msg.content}
                      </span>
                    </div>
                  );
                }

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.3) }}
                    className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="max-w-[70%] group relative">
                      <div
                        className={`p-4 rounded-2xl ${
                          isOutgoing
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background border border-border/60 text-foreground'
                        }`}
                      >
                        {editingMsgId === msg.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && editContent.trim()) {
                                  editMessage(selectedId!, msg.id, editContent.trim());
                                  setEditingMsgId(null);
                                }
                                if (e.key === 'Escape') setEditingMsgId(null);
                              }}
                              className="flex-1 bg-transparent border-b border-current text-sm focus:outline-none"
                              autoFocus
                              aria-label="Edit message"
                            />
                            <button onClick={() => { if (editContent.trim()) { editMessage(selectedId!, msg.id, editContent.trim()); setEditingMsgId(null); } }} className="p-1 rounded hover:bg-white/20" aria-label="Confirm edit">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setEditingMsgId(null)} className="p-1 rounded hover:bg-white/20" aria-label="Cancel edit">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm leading-relaxed">{msg.content}</p>
                        )}
                        <span
                          className={`text-[10px] mt-2 block ${
                            isOutgoing ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          }`}
                        >
                          {formatRelativeTime(msg.createdAt)}
                        </span>
                      </div>
                      {isOutgoing && editingMsgId !== msg.id && (
                        <div className="absolute -bottom-1 right-0 hidden group-hover:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content); }}
                            className="p-1 rounded-md bg-background border border-border/60 text-muted-foreground hover:text-foreground shadow-sm"
                            aria-label="Edit message"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => { if (window.confirm('Delete this message?')) deleteMessage(selectedId!, msg.id); }}
                            className="p-1 rounded-md bg-background border border-border/60 text-muted-foreground hover:text-red-600 shadow-sm"
                            aria-label="Delete message"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}

              {isContactTyping && (
                <div className="flex justify-start">
                  <div className="bg-background border border-border/60 px-4 py-3 rounded-2xl flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form
              onSubmit={handleSendMessage}
              className="p-4 border-t border-border/60 bg-card/80"
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="p-2 rounded-xl hover:bg-secondary text-muted-foreground transition-colors"
                  aria-label="Attach file"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <input
                  type="text"
                  placeholder="Type your message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  className="flex-1 h-10 px-4 rounded-xl bg-background border border-input text-sm focus:outline-none focus:border-primary"
                  aria-label="Type your message"
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors shadow-md shadow-primary/20"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                {(['whatsapp', 'sms', 'email'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    disabled={!messageInput.trim()}
                    onClick={() => handleOutbound(ch)}
                    className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg bg-secondary hover:bg-secondary/80 disabled:opacity-40"
                  >
                    Send via {ch}
                  </button>
                ))}
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a conversation to start messaging
          </div>
        )}
      </div>

      {/* AI Assistant Panel */}
      <div className="w-80 border-l border-border/60 bg-card/50 flex flex-col shrink-0">
        <div className="p-4 border-b border-border/60 flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground font-heading">AI Assistant</h2>
          <span className="ml-auto text-[10px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            Online
          </span>
        </div>
        <div className="p-3 border-b border-border/60 bg-secondary/20">
          <p className="text-xs text-muted-foreground">
            FAQ mode active. Ask about bookings, pricing, or travel requirements.
          </p>
        </div>

        {latestQuickReplies.length > 0 && (
          <div className="p-3 border-b border-border/60 flex flex-wrap gap-2">
            {latestQuickReplies.map((reply) => (
              <button
                key={reply}
                type="button"
                onClick={() => handleSendAiMessage(reply)}
                className="p-2 rounded-xl bg-secondary/40 border border-border/60 text-xs text-foreground hover:bg-secondary/60 transition-colors"
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {aiMessages.map((msg) => (
            <div
              key={msg.id}
              className={`p-2.5 rounded-xl text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground ml-6'
                  : msg.role === 'system'
                    ? 'bg-secondary/30 text-muted-foreground text-center italic'
                    : 'bg-secondary/40 border border-border/60 text-foreground mr-6'
              }`}
            >
              {msg.content}
            </div>
          ))}

          {aiIsTyping && (
            <div className="p-2.5 rounded-xl bg-secondary/40 border border-border/60 mr-6 flex items-center gap-1 w-fit">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
            </div>
          )}
          <div ref={aiEndRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendAiMessage();
          }}
          className="p-3 border-t border-border/60"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Ask the assistant..."
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              className="flex-1 h-9 px-3 rounded-xl bg-background border border-input text-xs focus:outline-none focus:border-primary"
              aria-label="Ask the AI assistant"
            />
            <button
              type="submit"
              disabled={!aiInput.trim() || aiIsTyping}
              className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              aria-label="Send message to AI assistant"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
