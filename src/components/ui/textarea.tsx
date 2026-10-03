import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-sm border border-input bg-surface px-3 py-2 text-[15px] leading-6 text-ink focus-visible:border-brand-navy transition-[color,box-shadow] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken disabled:text-ink-disabled aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
