'use client';

import { HTML_IFRAME_SANDBOX } from '@/lib/docs/html-artifact.ts';

export interface HtmlPreviewProps {
  readonly title: string;
  readonly html: string;
}

export function HtmlPreview({ title, html }: HtmlPreviewProps) {
  return (
    <iframe
      title={title}
      sandbox={HTML_IFRAME_SANDBOX}
      srcDoc={html}
      data-testid="html-preview"
      className="h-full min-h-0 w-full border-0 bg-white"
    />
  );
}
