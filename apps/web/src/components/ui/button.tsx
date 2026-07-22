'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/cn.ts';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-[opacity,transform,background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)] active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-accent text-accent-contrast hover:bg-accent-hover focus-visible:outline-accent',
        secondary: 'border-border bg-surface text-text hover:bg-surface-2',
        ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-text',
        danger: 'border-transparent bg-danger text-white hover:bg-danger-hover',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-3.5 text-dense',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      block: false,
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  type = 'button',
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...(asChild ? {} : { type })}
      {...props}
    />
  );
}
