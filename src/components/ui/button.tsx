import { cva, type VariantProps } from "class-variance-authority"
import { Slot as SlotPrimitive } from "radix-ui"
import * as React from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "border border-white/28 bg-primary/90 text-primary-foreground hover:bg-primary/85",
        destructive:
          "border border-white/18 bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-slate-300/65 bg-[var(--glass-chip-bg)] text-foreground backdrop-blur-xl hover:bg-white/55 hover:text-accent-foreground dark:border-white/16 dark:hover:bg-white/12",
        secondary:
          "border border-slate-300/60 bg-[var(--glass-chip-bg)] text-secondary-foreground backdrop-blur-xl hover:bg-white/55 dark:border-white/14 dark:hover:bg-white/12",
        ghost:
          "border border-transparent text-foreground hover:border-slate-300/45 hover:bg-white/45 hover:text-accent-foreground dark:hover:border-white/10 dark:hover:bg-white/8",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-10 px-5 text-sm has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? SlotPrimitive.Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
