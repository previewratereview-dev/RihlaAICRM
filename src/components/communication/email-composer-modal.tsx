'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Mail, Send, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export interface EmailComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  travelerName: string;
  travelerEmail: string;
  defaultSubject?: string;
  defaultContent?: string;
  inquiryId?: string;
  onSuccess?: () => void;
}

interface FormInnerProps {
  onClose: () => void;
  travelerName: string;
  travelerEmail: string;
  defaultSubject: string;
  defaultContent: string;
  onSuccess?: () => void;
}

function EmailComposerForm({
  onClose,
  travelerName,
  travelerEmail,
  defaultSubject,
  defaultContent,
  onSuccess,
}: FormInnerProps) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultContent);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCancel = () => {
    if (isSending) return;
    setErrorMessage(null);
    onClose();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) return; // double-submit protection
    if (!travelerEmail || !travelerEmail.trim()) {
      setErrorMessage('A valid recipient email address is required.');
      return;
    }
    if (!body || !body.trim()) {
      setErrorMessage('Email body cannot be empty.');
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/messaging/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: travelerEmail.trim(),
          subject: subject.trim() || 'Message from your travel specialist',
          content: body.trim(),
          leadName: travelerName || 'Traveler',
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || (data && data.ok === false)) {
        throw new Error(data.error || 'Server failed to deliver email.');
      }

      toast.success(`Email sent to ${travelerEmail}`);
      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send email. Please try again.';
      setErrorMessage(msg);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form onSubmit={handleSend}>
      <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Mail className="h-4 w-4" />
          </div>
          <div>
            <DialogTitle className="text-base font-bold font-heading">Compose Email</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Review and send an email directly to your client.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="p-6 space-y-4">
        {errorMessage && (
          <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Recipient */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
            Recipient
          </label>
          <div className="h-9 px-3 rounded-xl bg-muted/40 border border-border flex items-center text-xs text-foreground font-medium">
            <span className="text-muted-foreground mr-1">To:</span>
            <span className="font-semibold">{travelerName || 'Traveler'}</span>
            <span className="text-muted-foreground ml-1.5 font-mono">&lt;{travelerEmail || 'No email registered'}&gt;</span>
          </div>
        </div>

        {/* Subject */}
        <div className="space-y-1.5">
          <label htmlFor="email-subject" className="text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
            Subject
          </label>
          <Input
            id="email-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={isSending}
            placeholder="Subject line..."
            className="h-9 rounded-xl text-sm"
          />
        </div>

        {/* Message Body */}
        <div className="space-y-1.5">
          <label htmlFor="email-body" className="text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
            Message Body
          </label>
          <Textarea
            id="email-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={isSending}
            rows={6}
            placeholder="Write your email message here..."
            className="resize-none rounded-xl text-sm leading-relaxed"
          />
        </div>
      </div>

      <DialogFooter className="px-6 py-4 border-t border-border/60 bg-muted/20 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={isSending}
          className="h-9 px-4 text-xs font-semibold"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isSending || !travelerEmail || !body.trim()}
          className="h-9 px-4 text-xs font-semibold gap-1.5"
        >
          {isSending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5" />
              <span>Send Email</span>
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EmailComposerModal({
  isOpen,
  onClose,
  travelerName,
  travelerEmail,
  defaultSubject = 'Message regarding your travel inquiry',
  defaultContent = '',
  onSuccess,
}: EmailComposerModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px] bg-background border-border shadow-2xl p-0 overflow-hidden">
        {isOpen && (
          <EmailComposerForm
            onClose={onClose}
            travelerName={travelerName}
            travelerEmail={travelerEmail}
            defaultSubject={defaultSubject}
            defaultContent={defaultContent}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
