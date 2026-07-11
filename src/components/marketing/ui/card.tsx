import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  strong = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { strong?: boolean }) {
  return (
    <div
      className={cn(strong ? "glass-strong" : "glass", "p-6 md:p-8", className)}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("eyebrow", className)} {...props} />;
}
