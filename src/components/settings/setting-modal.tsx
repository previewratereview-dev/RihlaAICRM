import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LucideIcon } from 'lucide-react';

interface SettingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  icon: LucideIcon;
  children: React.ReactNode;
  onSave: () => Promise<void>;
  isSaving: boolean;
  saveButtonText?: string;
  danger?: boolean;
  hideFooter?: boolean;
}

export function SettingModal({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  children,
  onSave,
  isSaving,
  saveButtonText = 'Save Changes',
  danger = false,
  hideFooter = false
}: SettingModalProps) {
  
  const handleSave = async () => {
    try {
      await onSave();
      onOpenChange(false);
    } catch (e: unknown) {
      console.error(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-muted/50 text-muted-foreground">
              <Icon className="w-5 h-5" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          {children}
        </div>

        {!hideFooter && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              variant={danger ? "destructive" : "default"}
            >
              {isSaving ? 'Saving...' : saveButtonText}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

