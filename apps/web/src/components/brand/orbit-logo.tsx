import { cn } from '@/lib/cn.ts';

export function OrbitMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    // biome-ignore lint/performance/noImgElement: fixed-size static brand mark, not routed through the next/image optimizer
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={cn('shrink-0 select-none', className)}
    />
  );
}

export function OrbitWordmark({
  compact = false,
  size = 20,
  className,
}: {
  compact?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <OrbitMark size={size} />
      {compact ? null : <span className="text-base font-semibold tracking-tight">Orbit</span>}
    </span>
  );
}
