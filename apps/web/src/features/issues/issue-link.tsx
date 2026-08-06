'use client';

import Link from 'next/link';
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';

const PEEK_KEY = ' ';

export function issueHref(identifier: string): string {
  return `/issue/${identifier}`;
}

export function isPlainClick(event: ReactMouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isUnmodifiedPeekKey(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return (
    event.key === PEEK_KEY &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.repeat
  );
}

export interface IssueLinkProps {
  readonly identifier: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly label?: string | undefined;
  readonly draggable?: boolean | undefined;
  readonly prefetch?: boolean | undefined;
  readonly tabIndex?: number | undefined;
  readonly testId?: string | undefined;
  readonly onFocus?: ((event: ReactFocusEvent<HTMLAnchorElement>) => void) | undefined;
  readonly onClick?: ((event: ReactMouseEvent<HTMLAnchorElement>) => void) | undefined;
  readonly onPlainClick?: (() => void) | undefined;
}

export function IssueLink({
  identifier,
  children,
  className,
  label,
  draggable,
  prefetch,
  tabIndex,
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

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLAnchorElement>) => {
    if (onPlainClick === undefined || event.defaultPrevented || !isUnmodifiedPeekKey(event)) return;
    event.preventDefault();
    onPlainClick();
  };

  return (
    <Link
      href={issueHref(identifier)}
      aria-label={label}
      draggable={draggable}
      prefetch={prefetch ?? null}
      tabIndex={tabIndex}
      data-testid={testId}
      onFocus={onFocus}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={className}
    >
      {children}
    </Link>
  );
}
