'use client';

import { DOC_CONTENT_LIMIT } from '@orbit/shared/validators';
import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { messageOf } from '@/lib/query/fetcher.ts';
import { useCreateDoc } from '@/lib/query/use-docs.ts';
import { parseMarkdownImport } from './doc-transfer.ts';

const MAX_IMPORT_BYTES = DOC_CONTENT_LIMIT * 4;

const importedDocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(DOC_CONTENT_LIMIT),
});

export interface DocImportProps {
  readonly collectionId: string | null;
  readonly projectId: string | null;
}

export function DocImport({ collectionId, projectId }: DocImportProps) {
  const router = useRouter();
  const create = useCreateDoc();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function take(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error('That file is too long to import. Split it into linked pages.');
    }
    const text = await file.text();
    if (text.length > DOC_CONTENT_LIMIT) {
      throw new Error('That file is too long to import. Split it into linked pages.');
    }
    const parsed = importedDocSchema.parse(parseMarkdownImport(file.name, text));
    const doc = await create.mutateAsync({
      title: parsed.title,
      content: parsed.content,
      collectionId,
      projectId,
    });
    router.push(`/docs/${doc.id}`);
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown,.mdx,text/markdown"
        className="hidden"
        data-testid="doc-import-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          setBusy(true);
          take(file)
            .catch((error: unknown) =>
              toast({
                title: 'Could not import that file',
                description: messageOf(error),
                tone: 'danger',
              }),
            )
            .finally(() => setBusy(false));
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        data-testid="doc-import"
        onClick={() => input.current?.click()}
      >
        <Upload className="size-3.5" aria-hidden="true" />
        Import Markdown
      </Button>
    </>
  );
}
