'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, [contenteditable]';

export function EnterToSignIn() {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && event.target.closest(INTERACTIVE_SELECTOR)) return;
      router.push('/login');
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return null;
}
