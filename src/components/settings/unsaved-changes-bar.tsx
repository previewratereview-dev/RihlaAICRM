import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UnsavedChangesBarProps {
  show: boolean;
  onSave: () => void;
  onDiscard: () => void;
  isSaving?: boolean;
}

export function UnsavedChangesBar({ show, onSave, onDiscard, isSaving = false }: UnsavedChangesBarProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ duration: 0.2, type: 'spring', stiffness: 300, damping: 25 }}
          className={cn(
            "fixed bottom-8 left-1/2 -translate-x-1/2 z-50",
            "flex items-center gap-4 px-4 py-3 rounded-2xl shadow-xl border",
            "bg-foreground text-background border-border/20 backdrop-blur-xl"
          )}
        >
          <div className="flex flex-col ml-2 mr-4">
            <span className="text-sm font-semibold leading-tight text-background">Unsaved changes</span>
            <span className="text-xs text-muted leading-tight mt-0.5">Please save or discard your edits.</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onDiscard} 
              disabled={isSaving}
              className="text-muted hover:text-background hover:bg-background/20 rounded-xl px-4 h-9"
            >
              Discard
            </Button>
            <Button 
              size="sm" 
              onClick={onSave} 
              disabled={isSaving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl px-4 h-9 shadow-md shadow-primary/20"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-background border-t-transparent" />
                  Saving...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Save className="h-4 w-4" />
                  Save Changes
                </div>
              )}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
