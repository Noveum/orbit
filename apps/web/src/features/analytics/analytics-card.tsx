import type { ReactNode } from 'react';

export function AnalyticsCard({
  title,
  children,
}: {
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {title === undefined ? null : <h2 className="font-medium text-dense text-text">{title}</h2>}
      {children}
    </section>
  );
}
