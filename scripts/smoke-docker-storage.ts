import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageDriver } from '../packages/services/src/storage/index';

const storage = createStorageDriver();
const origin = new URL(process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://127.0.0.1:33170').origin;
const uploads = [
  { name: 'notes.md', type: 'text/markdown', body: '# Preview document\nPersistent file test.\n' },
  { name: 'report.pdf', type: 'application/pdf', body: '%PDF-1.7\nPreview storage probe\n%%EOF\n' },
  { name: 'image.svg', type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
];

for (const upload of uploads) {
  const key = `org_preview_smoke/${randomUUID()}/${upload.name}`;
  const body = new Blob([upload.body]);
  try {
    const target = await storage.createUploadTarget(key, upload.type, body.size);
    const preflight = await fetch(target.url, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.ok(preflight.ok);
    const methods =
      preflight.headers
        .get('access-control-allow-methods')
        ?.split(',')
        .map((value) => value.trim().toUpperCase()) ?? [];
    assert.ok(methods.includes('PUT'), 'CORS preflight must allow PUT');
    const headers =
      preflight.headers
        .get('access-control-allow-headers')
        ?.split(',')
        .map((value) => value.trim().toLowerCase()) ?? [];
    assert.ok(headers.includes('content-type'), 'CORS preflight must allow content-type');
    const put = await fetch(target.url, {
      method: target.method,
      headers: { ...target.headers, origin },
      body,
    });
    assert.ok(put.ok);
    assert.equal(put.headers.get('access-control-allow-origin'), origin);
    assert.equal((await storage.stat(key))?.size, body.size);
    const url = await storage.getUrl(key, 60, { contentType: upload.type });
    const download = await fetch(url, { headers: { origin } });
    assert.ok(download.ok);
    assert.equal(download.headers.get('access-control-allow-origin'), origin);
    assert.equal(download.headers.get('content-type'), upload.type);
    assert.equal(await download.text(), upload.body);
    const foreign = await fetch(target.url, {
      method: 'OPTIONS',
      headers: { origin: 'https://unrelated.example', 'access-control-request-method': 'PUT' },
    });
    assert.notEqual(
      foreign.headers.get('access-control-allow-origin'),
      'https://unrelated.example',
    );
    console.info(`Verified presigned upload, download, metadata and CORS: ${upload.type}`);
  } finally {
    await storage.delete(key);
  }
}
