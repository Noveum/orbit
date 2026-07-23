import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type * as schema from '../schema/index.ts';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export const IMAGE_TAG_SOURCE = `<image-component(?=[\\s/>])[^>]*\\bsrc="(${UUID})"[^>]*>(?:</image-component>)?`;

const IMAGE_TAG = new RegExp(IMAGE_TAG_SOURCE, 'g');

const manifestSchema = z.record(
  z.string(),
  z.object({
    fileName: z.string(),
    contentType: z.string(),
    size: z.number().int().nonnegative(),
  }),
);

export type AssetManifest = z.infer<typeof manifestSchema>;

export function readAssetManifest(root: string): AssetManifest {
  const path = resolve(root, 'assets.json');
  if (!existsSync(path)) return {};
  return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'file';
}

export interface AssetStore {
  readonly manifest: AssetManifest;
  readonly sourceRoot: string;
  readonly storageRoot: string;
  readonly organizationId: string;
  readonly attachments: (typeof schema.attachment.$inferInsert)[];
  readonly keys: Map<string, string>;
}

export function createAssetStore(
  root: string,
  storageRoot: string,
  organizationId: string,
): AssetStore {
  return {
    manifest: readAssetManifest(root),
    sourceRoot: resolve(root, 'assets'),
    storageRoot,
    organizationId,
    attachments: [],
    keys: new Map(),
  };
}

function storeAsset(
  store: AssetStore,
  assetId: string,
  parentType: string,
  parentId: string,
  uploadedById: string,
): string | null {
  const cached = store.keys.get(assetId);
  if (cached !== undefined) return cached;

  const entry = store.manifest[assetId];
  if (entry === undefined) return null;

  const source = resolve(store.sourceRoot, assetId);
  if (!existsSync(source)) return null;

  const key = `${safeSegment(store.organizationId)}/plane/${assetId}-${safeSegment(entry.fileName)}`;
  const destination = resolve(store.storageRoot, key);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);

  store.keys.set(assetId, key);
  store.attachments.push({
    id: randomUUID(),
    organizationId: store.organizationId,
    parentType,
    parentId,
    fileName: entry.fileName,
    contentType: entry.contentType,
    size: entry.size,
    storageKey: key,
    uploadedById,
    status: 'ready',
  });
  return key;
}

export function inlineAssets(
  html: string | null | undefined,
  parentType: 'issue' | 'comment' | 'doc',
  parentId: string,
  uploadedById: string,
  store: AssetStore,
): string {
  if (typeof html !== 'string' || html.length === 0) return html ?? '';

  return html.replace(IMAGE_TAG, (match, rawId: string) => {
    const key = storeAsset(store, rawId, parentType, parentId, uploadedById);
    const entry = store.manifest[rawId];
    if (key === null || entry === undefined) return match;
    const alt = entry.fileName.replace(/"/g, '&quot;');
    return `<img alt="${alt}" src="/api/files/${key}">`;
  });
}
