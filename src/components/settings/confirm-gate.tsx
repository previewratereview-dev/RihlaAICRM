import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldAlert } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';

interface ConfirmGateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
}

export function ConfirmGate({
  open,
  onOpenChange,
  onConfirm,
  title = "Security Confirmation",
  description = "This is a sensitive setting. Please confirm your email address to proceed."
}: ConfirmGateProps) {
  const currentUser = useCRMStore((s) => s.currentUser);
  const [emailInput, setEmailInput] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    if (!currentUser) return;
    
    if (emailInput.toLowerCase().trim() === currentUser.email.toLowerCase().trim()) {
      setError('');
      onConfirm();
    } else {
      setError('Email does not match. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (!val) {
        setEmailInput('');
        setError('');
      }
      onOpenChange(val);
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-destructive/10 text-destructive">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email Address</label>
            <Input 
              type="email" 
              placeholder="you@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleConfirm();
                }
              }}
            />
            {error && (
              <p className="text-sm text-destructive mt-1">{error}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!emailInput.trim()}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
