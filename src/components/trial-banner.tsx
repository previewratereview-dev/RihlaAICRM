'use client';

import React from 'react';
import { Clock, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface TrialBannerProps {
  daysLeft: number;
  onUpgrade: () => void;
}

export function TrialBanner({ daysLeft, onUpgrade }: TrialBannerProps) {
  if (daysLeft <= 0) return null;

  const urgency = daysLeft <= 2 ? 'high' : daysLeft <= 5 ? 'medium' : 'low';

  const bgColors = {
    high: 'bg-gradient-to-r from-red-500 to-rose-600',
    medium: 'bg-gradient-to-r from-amber-500 to-orange-600',
    low: 'bg-gradient-to-r from-blue-500 to-indigo-600',
  };

  return (
    <motion.div
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className={`${bgColors[urgency]} text-white px-4 py-2.5 flex items-center justify-between text-sm`}
    >
      <div className="flex items-center gap-3">
        <Clock className="h-4 w-4" />
        <span className="font-medium">
          {daysLeft === 1
            ? 'Your free trial expires tomorrow!'
            : `${daysLeft} days left in your free trial`}
        </span>
        <span className="hidden sm:inline text-white/70">
          — Full access to all Pro features
        </span>
      </div>
      <button
        onClick={onUpgrade}
        className="inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-semibold px-4 py-1.5 rounded-lg transition-all text-xs"
      >
        <Zap className="h-3.5 w-3.5" />
        Upgrade Now
      </button>
    </motion.div>
  );
}
