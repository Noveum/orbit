'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { describeAuthError } from '@/lib/auth/oauth-error.ts';

export interface AuthErrorNoticeProps {
  readonly code: string;
  readonly title?: string;
}

export function AuthErrorNotice({ code, title = 'Sign in failed' }: AuthErrorNoticeProps) {
  const router = useRouter();
  const { toast } = useToast();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    toast({ title, description: describeAuthError(code), tone: 'danger' });
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [code, title, router, toast]);

  return null;
}
