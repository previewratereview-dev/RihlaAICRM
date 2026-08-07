import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "flex h-[var(--control-height)] w-full min-w-0 rounded-xl border border-input bg-transparent px-3 py-2 text-[var(--text-body)] transition-all duration-200 outline-none file:inline-flex file:h-full file:border-0 file:bg-transparent file:text-[var(--text-body)] file:font-medium file:text-foreground placeholder:text-muted-foreground/80 hover:border-primary/30 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 shadow-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
