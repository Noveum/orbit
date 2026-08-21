'use client';

import { HtmlPreview } from './html-preview.tsx';

export interface HtmlDocReaderProps {
  readonly title: string;
  readonly content: string;
}

export function HtmlDocReader({ title, content }: HtmlDocReaderProps) {
  return (
    <div className="min-h-0 flex-1 bg-white" data-testid="html-doc-reader">
      <HtmlPreview title={title} html={content} />
    </div>
  );
}
