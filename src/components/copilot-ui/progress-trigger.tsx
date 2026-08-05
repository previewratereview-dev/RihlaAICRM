'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

export function ProgressTrigger({ step }: { step: string }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('updateSetupProgress', { detail: step }));
  }, [step]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl mt-2 w-fit"
    >
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-sm font-medium">Progress updated to {step}</span>
      </div>
    </motion.div>
  );
}
