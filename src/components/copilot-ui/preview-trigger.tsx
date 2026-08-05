'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';

export function PreviewTrigger() {
  useEffect(() => {
    // Dispatch a custom event to notify the client-page layout to switch into preview mode
    window.dispatchEvent(new Event('triggerPreviewMode'));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-4 bg-primary/10 border border-primary/20 rounded-xl mt-2"
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <div>
          <h4 className="font-semibold text-foreground text-sm">Preparing CRM Preview...</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Please wait while I load the dashboard.</p>
        </div>
      </div>
    </motion.div>
  );
}
