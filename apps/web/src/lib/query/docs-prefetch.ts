import { getDoc } from '@orbit/core';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { isDomainError } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { docListPayload } from '@/lib/api/docs.ts';
import { queryKeys } from './keys.ts';
import type { DocDetail, DocList } from './schemas.ts';
import { docDetailSchema, docListSchema } from './schemas.ts';

function asWire<T>(schema: { parse: (value: unknown) => T }, payload: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(payload)));
}

async function docList(principal: Principal): Promise<DocList> {
  return asWire(docListSchema, await docListPayload(principal));
}

async function docDetail(principal: Principal, docId: string): Promise<DocDetail | null> {
  try {
    const detail = await getDoc(principal, docId);
    return asWire(docDetailSchema, {
      ...detail,
      contentHtml: renderMarkdownWithHeadingIds(detail.doc.content),
    });
  } catch (error) {
    if (isDomainError(error) && error.code === 'not_found') return null;
    throw error;
  }
}

export async function dehydratedDocList(principal: Principal) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.docs(''), await docList(principal));
  return dehydrate(client);
}

export async function dehydratedDoc(principal: Principal, docId: string) {
  const client = new QueryClient();
  const detail = await docDetail(principal, docId);
  if (detail !== null) client.setQueryData(queryKeys.doc(docId), detail);
  return dehydrate(client);
}
