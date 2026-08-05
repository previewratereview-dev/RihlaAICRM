'use client';

import React from 'react';
import { Settings, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function SettingsCard({ integration }: { integration: string }) {
  const router = useRouter();
  
  const title = integration.toLowerCase() === 'whatsapp' ? 'WhatsApp Configuration' : 'Integration Settings';

  return (
    <div className="p-4 rounded-xl border border-border bg-card shadow-sm mt-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Settings className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-muted-foreground">Manage your API credentials.</p>
        </div>
      </div>
      
      <div className="mt-4">
        <button
          onClick={() => router.push('/app')}
          className="w-full h-8 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-border"
        >
          <span>Open Settings Dashboard</span>
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
