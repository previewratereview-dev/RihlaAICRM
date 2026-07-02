'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center font-sans">
        <h1 className="text-2xl font-bold">Application Error</h1>
        <p className="text-muted-foreground max-w-md">{error.message || 'A critical error occurred.'}</p>
        <Button onClick={reset}>Reload application</Button>
      </body>
    </html>
  );
}
