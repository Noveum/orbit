import { afterAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createStorageDriver } from './index.ts';
import type { StorageDriver } from './types.ts';

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
  const raw = await Bun.file(`${REPO_ROOT}/k8s/s3-cors.json`).text();
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

  it('is applied by k8s/apply.sh, not just committed', async () => {
    const script = await Bun.file(`${REPO_ROOT}/k8s/apply.sh`).text();
    expect(script).toContain('put-bucket-cors');
    expect(script).toContain('s3-cors.json');
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

const driver: StorageDriver = createStorageDriver();
const written: string[] = [];

afterAll(async () => {
  await Promise.all(written.map((key) => driver.delete(key)));
});

describe('presign, PUT and GET against object storage', () => {
  for (const upload of UPLOADS) {
    it(`round trips ${upload.contentType} with its content type intact`, async () => {
      const key = `org_round_trip/2026/07/${Bun.randomUUIDv7()}-${upload.name}`;
      const target = await driver.createUploadTarget(key, upload.contentType);
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

      const stored = await driver.stat(key);
      expect(stored?.contentType).toBe(upload.contentType);

      const downloadUrl = await driver.getUrl(key, 60, {
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

  it('stores the content type the client sent, so the client must send the target headers', async () => {
    const key = `org_round_trip/2026/07/${Bun.randomUUIDv7()}-mismatch.pdf`;
    const target = await driver.createUploadTarget(key, 'application/pdf');
    written.push(key);

    await fetch(target.url, {
      method: target.method,
      headers: { 'content-type': 'text/html' },
      body: bodyFor('application/pdf'),
    });

    expect((await driver.stat(key))?.contentType).toBe('text/html');
  });
});
