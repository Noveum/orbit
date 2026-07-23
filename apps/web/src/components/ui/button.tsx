'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/cn.ts';

export const buttonVariants = cva(
  'inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-[opacity,transform,background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)] not-disabled:active:scale-[0.985] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-accent text-accent-contrast not-disabled:not-aria-disabled:hover:bg-accent-hover focus-visible:outline-offset-2',
        secondary:
          'border-border bg-surface text-text not-disabled:not-aria-disabled:hover:bg-surface-2 data-[state=open]:bg-surface-2',
        ghost:
          'border-transparent bg-transparent text-muted not-disabled:not-aria-disabled:hover:bg-surface-2 not-disabled:not-aria-disabled:hover:text-text data-[state=open]:bg-surface-2 data-[state=open]:text-text',
        danger:
          'border-transparent bg-danger text-danger-contrast not-disabled:not-aria-disabled:hover:bg-danger-hover focus-visible:outline-offset-2',
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
