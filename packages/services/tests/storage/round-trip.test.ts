import { afterAll, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createStorageDriver } from '../../src/storage/index.ts';
import type { StorageDriver } from '../../src/storage/types.ts';

const REPO_ROOT = `${import.meta.dir}/../../../..`;
const ORIGIN_PLACEHOLDER = '__ORBIT_ORIGIN__';
const PRODUCTION_ORIGIN = 'https://orbit.noveum.ai';
const FOREIGN_ORIGIN = 'https://evil.example';

const corsRuleSchema = z.object({
  AllowedOrigins: z.array(z.string()).min(1),
  AllowedMethods: z.array(z.string()).min(1),
  AllowedHeaders: z.array(z.string()),
  ExposeHeaders: z.array(z.string()),
  MaxAgeSeconds: z.number().int().positive(),
});

const corsDocumentSchema = z.object({ CORSRules: z.array(corsRuleSchema).min(1) });

type CorsRule = z.infer<typeof corsRuleSchema>;

interface Preflight {
  readonly origin: string;
  readonly method: string;
  readonly header: string;
}

function matches(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => {
    if (pattern === '*') return true;
    const star = pattern.indexOf('*');
    if (star === -1) return pattern.toLowerCase() === value.toLowerCase();
    const head = pattern.slice(0, star).toLowerCase();
    const tail = pattern.slice(star + 1).toLowerCase();
    const lowered = value.toLowerCase();
    return lowered.startsWith(head) && lowered.endsWith(tail);
  });
}

function allows(rules: readonly CorsRule[], request: Preflight): boolean {
  return rules.some(
    (rule) =>
      matches(rule.AllowedOrigins, request.origin) &&
      matches(rule.AllowedMethods, request.method) &&
      matches(rule.AllowedHeaders, request.header),
  );
}

async function loadRules(): Promise<CorsRule[]> {
  const raw = await readFile(`${REPO_ROOT}/infra/s3-cors.json`, 'utf8');
  const document = corsDocumentSchema.parse(
    JSON.parse(raw.replaceAll(ORIGIN_PLACEHOLDER, PRODUCTION_ORIGIN)),
  );
  return document.CORSRules;
}

describe('bucket CORS document', () => {
  it('allows exactly the presigned upload the browser performs', async () => {
    const rules = await loadRules();

    expect(
      allows(rules, { origin: PRODUCTION_ORIGIN, method: 'PUT', header: 'content-type' }),
    ).toBe(true);
    expect(
      allows(rules, { origin: PRODUCTION_ORIGIN, method: 'GET', header: 'content-type' }),
    ).toBe(true);
    expect(
      allows(rules, { origin: PRODUCTION_ORIGIN, method: 'HEAD', header: 'content-type' }),
    ).toBe(true);
    expect(rules.some((rule) => rule.ExposeHeaders.includes('ETag'))).toBe(true);
  });

  it('refuses a foreign origin and a method the app never uses', async () => {
    const rules = await loadRules();

    expect(allows(rules, { origin: FOREIGN_ORIGIN, method: 'PUT', header: 'content-type' })).toBe(
      false,
    );
    expect(
      allows(rules, { origin: PRODUCTION_ORIGIN, method: 'DELETE', header: 'content-type' }),
    ).toBe(false);
    expect(
      allows(rules, { origin: PRODUCTION_ORIGIN, method: 'PUT', header: 'x-amz-meta-smuggled' }),
    ).toBe(false);
    expect(rules.some((rule) => rule.AllowedOrigins.includes('*'))).toBe(false);
    expect(rules.some((rule) => rule.AllowedHeaders.includes('*'))).toBe(false);
  });

  it('documents how it reaches the bucket', async () => {
    const readme = await readFile(`${REPO_ROOT}/infra/README.md`, 'utf8');
    expect(readme).toContain(
      "sed 's|__ORBIT_ORIGIN__|https://orbit.example.com|' infra/s3-cors.json > /tmp/cors.json",
    );
    expect(readme).toContain(
      'aws s3api put-bucket-cors --bucket "$S3_BUCKET" --cors-configuration file:///tmp/cors.json',
    );
  });
});

const UPLOADS: readonly { readonly name: string; readonly contentType: string }[] = [
  { name: 'quarterly-report.pdf', contentType: 'application/pdf' },
  { name: 'screenshot.png', contentType: 'image/png' },
  { name: 'notes.txt', contentType: 'text/plain' },
];

function bodyFor(contentType: string): Blob {
  if (contentType === 'application/pdf') {
    return new Blob(['%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n']);
  }
  if (contentType === 'image/png') {
    return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])]);
  }
  return new Blob(['plain notes\n']);
}

const storageConfigured = Boolean(process.env['S3_BUCKET']);
const written: string[] = [];
let cachedDriver: StorageDriver | undefined;

function storage(): StorageDriver {
  cachedDriver ??= createStorageDriver();
  return cachedDriver;
}

afterAll(async () => {
  if (written.length === 0) return;
  await Promise.all(written.map((key) => storage().delete(key)));
});

describe.skipIf(!storageConfigured)('presign, PUT and GET against object storage', () => {
  for (const upload of UPLOADS) {
    it(`round trips ${upload.contentType} with its content type intact`, async () => {
      const key = `org_round_trip/2026/07/${Bun.randomUUIDv7()}-${upload.name}`;
      const target = await storage().createUploadTarget(
        key,
        upload.contentType,
        bodyFor(upload.contentType).size,
      );
      written.push(key);

      expect(Object.keys(target.headers)).toEqual(['content-type']);

      const preflight = await fetch(target.url, {
        method: 'OPTIONS',
        headers: {
          origin: PRODUCTION_ORIGIN,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type',
        },
      });
      expect(preflight.status).toBeLessThan(400);

      const put = await fetch(target.url, {
        method: target.method,
        headers: { ...target.headers, origin: PRODUCTION_ORIGIN },
        body: bodyFor(upload.contentType),
      });
      expect(put.status).toBe(200);

      const stored = await storage().stat(key);
      expect(stored?.contentType).toBe(upload.contentType);

      const downloadUrl = await storage().getUrl(key, 60, {
        contentType: upload.contentType,
        disposition: `inline; filename="${upload.name}"`,
      });
      const download = await fetch(downloadUrl);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe(upload.contentType);
      expect(download.headers.get('content-disposition')).toBe(`inline; filename="${upload.name}"`);
      expect((await download.arrayBuffer()).byteLength).toBe(bodyFor(upload.contentType).size);
    });
  }

  it('refuses an upload larger than the presigned length and stores nothing', async () => {
    const key = `org_round_trip/2026/07/${Bun.randomUUIDv7()}-oversized.txt`;
    const declared = new Blob(['ten bytes!']);
    const target = await storage().createUploadTarget(key, 'text/plain', declared.size);

    const oversized = await fetch(target.url, {
      method: target.method,
      headers: { ...target.headers, origin: PRODUCTION_ORIGIN },
      body: new Blob([`${'x'.repeat(declared.size * 100)}`]),
    });

    expect(oversized.status).toBeGreaterThanOrEqual(400);
    expect(await storage().stat(key)).toBeNull();

    const honest = await fetch(target.url, {
      method: target.method,
      headers: { ...target.headers, origin: PRODUCTION_ORIGIN },
      body: declared,
    });
    written.push(key);
    expect(honest.status).toBe(200);
    expect((await storage().stat(key))?.size).toBe(declared.size);
  });

  it('stores the content type the client sent, so the client must send the target headers', async () => {
    const key = `org_round_trip/2026/07/${Bun.randomUUIDv7()}-mismatch.pdf`;
    const body = bodyFor('application/pdf');
    const target = await storage().createUploadTarget(key, 'application/pdf', body.size);
    written.push(key);

    await fetch(target.url, {
      method: target.method,
      headers: { 'content-type': 'text/html' },
      body,
    });

    expect((await storage().stat(key))?.contentType).toBe('text/html');
  });
});
