'use client';

import Link from 'next/link';
import type {
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';

export function issueHref(identifier: string): string {
  return `/issue/${identifier}`;
}

export function isPlainClick(event: ReactMouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export interface IssueLinkProps {
  readonly identifier: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
  readonly label?: string | undefined;
  readonly draggable?: boolean | undefined;
  readonly testId?: string | undefined;
  readonly onFocus?: ((event: ReactFocusEvent<HTMLAnchorElement>) => void) | undefined;
  readonly onClick?: ((event: ReactMouseEvent<HTMLAnchorElement>) => void) | undefined;
  readonly onPlainClick?: (() => void) | undefined;
}

export function IssueLink({
  identifier,
  children,
  className,
  title,
  label,
  draggable,
  testId,
  onFocus,
  onClick,
  onPlainClick,
}: IssueLinkProps) {
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (onPlainClick === undefined || event.defaultPrevented || !isPlainClick(event)) return;
    event.preventDefault();
    onPlainClick();
  };

  return (
    <Link
      href={issueHref(identifier)}
      title={title}
      aria-label={label}
      draggable={draggable}
      data-testid={testId}
      onFocus={onFocus}
      onClick={handleClick}
      className={className}
    >
      {children}
    </Link>
  );
}
