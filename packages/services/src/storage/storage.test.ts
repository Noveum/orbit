import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DomainError, MAX_UPLOAD_BYTES } from '@orbit/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStorageDriver,
  kindOf,
  LocalStorageDriver,
  S3StorageDriver,
  sanitizeFileName,
  storageKeyFor,
  validateUpload,
} from './index.ts';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'orbit-storage-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('kindOf', () => {
  it('classifies every supported preview kind', () => {
    expect(kindOf('image/png')).toBe('image');
    expect(kindOf('video/mp4')).toBe('video');
    expect(kindOf('audio/mpeg')).toBe('audio');
    expect(kindOf('application/pdf')).toBe('pdf');
    expect(kindOf('text/markdown')).toBe('text');
    expect(kindOf('application/zip')).toBe('other');
  });
});

describe('validateUpload', () => {
  it('accepts images, pdfs, video and audio', () => {
    for (const contentType of ['image/png', 'application/pdf', 'video/mp4', 'audio/wav']) {
      expect(validateUpload({ fileName: 'a.bin', contentType, size: 10 }).contentType).toBe(
        contentType,
      );
    }
  });

  it('throws payload_too_large past the byte cap', () => {
    const call = () =>
      validateUpload({ fileName: 'big.mp4', contentType: 'video/mp4', size: MAX_UPLOAD_BYTES + 1 });
    expect(call).toThrow(DomainError);
    expect(call).toThrow(/or smaller/);
    try {
      call();
    } catch (error) {
      expect((error as DomainError).code).toBe('payload_too_large');
      expect((error as DomainError).status).toBe(413);
    }
  });

  it('throws unsupported_media_type for a disallowed mime prefix', () => {
    try {
      validateUpload({ fileName: 'x.exe', contentType: 'application/x-msdownload', size: 10 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DomainError).code).toBe('unsupported_media_type');
    }
  });

  it('rejects malformed input', () => {
    expect(() => validateUpload({ fileName: '', contentType: 'image/png', size: 1 })).toThrow(
      DomainError,
    );
    expect(() => validateUpload({ fileName: 'a.png', contentType: 'image/png', size: 0 })).toThrow(
      DomainError,
    );
  });

  it('sanitizes the file name', () => {
    const result = validateUpload({
      fileName: '../../etc/pa ss wd.png',
      contentType: 'image/png',
      size: 4,
    });
    expect(result.safeName).toBe('pa-ss-wd.png');
    expect(result.kind).toBe('image');
  });
});

describe('sanitizeFileName', () => {
  it('strips paths, exotic characters and leading dots', () => {
    expect(sanitizeFileName('/tmp/../a/b/Report Final(2).PDF')).toBe('Report-Final-2-.PDF');
    expect(sanitizeFileName('.....')).toBe('file');
    expect(sanitizeFileName('C:\\Users\\me\\pic.png')).toBe('pic.png');
  });
});

describe('storageKeyFor', () => {
  it('builds org/year/month/ulid-name', () => {
    const key = storageKeyFor('org_123', 'My Photo.png', new Date('2026-03-09T00:00:00.000Z'));
    expect(key).toMatch(/^org_123\/2026\/03\/[0-9A-HJKMNP-TV-Z]{26}-My-Photo\.png$/);
  });

  it('requires an organization', () => {
    expect(() => storageKeyFor('   ', 'a.png')).toThrow(DomainError);
  });
});

describe('LocalStorageDriver', () => {
  it('round trips put, stat, getUrl and delete', async () => {
    const driver = new LocalStorageDriver(root);
    const key = 'org_1/2026/03/01HB-note.txt';
    await driver.put(key, new TextEncoder().encode('hello'), 'text/plain');
    expect(await readFile(path.join(root, key), 'utf8')).toBe('hello');

    const info = await driver.stat(key);
    expect(info?.size).toBe(5);
    expect(info?.contentType).toBe('text/plain');

    expect(await driver.getUrl(key, 60)).toBe(`/api/files/${key}`);

    const target = await driver.createUploadTarget(key, 'text/plain', 5);
    expect(target.method).toBe('PUT');
    expect(target.url).toBe(`/api/files/${key}`);

    await driver.delete(key);
    expect(await driver.stat(key)).toBeNull();
  });

  it('rejects keys that escape the root', async () => {
    const driver = new LocalStorageDriver(root);
    const escapes = [
      '../outside.txt',
      'org/../../outside.txt',
      '/etc/passwd',
      'a/./../../b.txt',
      '..',
      '',
    ];
    for (const key of escapes) {
      expect(() => driver.resolve(key)).toThrow(DomainError);
      await expect(driver.put(key, new Uint8Array([1]), 'text/plain')).rejects.toThrow(DomainError);
    }
    await expect(readFile(path.join(root, '..', 'outside.txt'))).rejects.toThrow();
  });

  it('returns null when a file is missing rather than throwing', async () => {
    const driver = new LocalStorageDriver(root);
    expect(await driver.stat('org_1/2026/03/nope.txt')).toBeNull();
    expect(await driver.stat('org_1')).toBeNull();
  });

  it('collapses harmless traversal inside the root', () => {
    const driver = new LocalStorageDriver(root);
    expect(driver.resolve('org/sub/../file.txt')).toBe(path.join(root, 'org', 'file.txt'));
  });
});

describe('S3StorageDriver', () => {
  const driver = new S3StorageDriver({
    bucket: 'orbit-uploads',
    region: 'us-east-1',
    endpoint: 'http://localhost:9010',
    accessKeyId: 'orbitminio',
    secretAccessKey: 'orbitminio',
  });

  it('presigns a PUT upload target against a path style endpoint', async () => {
    const target = await driver.createUploadTarget('org_1/2026/03/a.png', 'image/png', 12);
    expect(target.url).toContain('http://localhost:9010/orbit-uploads/org_1/2026/03/a.png');
    expect(target.url).toContain('X-Amz-Signature=');
    expect(target.method).toBe('PUT');
    expect(target.headers['content-type']).toBe('image/png');
  });

  it('presigns a GET download url with the requested ttl', async () => {
    const url = await driver.getUrl('org_1/2026/03/a.png', 120);
    expect(url).toContain('X-Amz-Expires=120');
    expect(url).toContain('X-Amz-Signature=');
  });

  it('rejects unsafe keys before signing', async () => {
    await expect(driver.getUrl('../secrets', 60)).rejects.toThrow(DomainError);
  });
});

describe('createStorageDriver', () => {
  it('selects local by default and s3 on request', () => {
    expect(createStorageDriver({}).name).toBe('local');
    expect(createStorageDriver({ STORAGE_DRIVER: 'local' }).name).toBe('local');
    expect(
      createStorageDriver({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'orbit-uploads',
        S3_ACCESS_KEY_ID: 'orbitminio',
        S3_SECRET_ACCESS_KEY: 'orbitminio',
        S3_ENDPOINT: 'http://localhost:9010',
      }).name,
    ).toBe('s3');
  });

  it('rejects an unknown driver', () => {
    expect(() => createStorageDriver({ STORAGE_DRIVER: 'ftp' })).toThrow(DomainError);
  });

  it('reports missing s3 configuration as a domain error', () => {
    expect(() => createStorageDriver({ STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET is required/);
    expect(() =>
      createStorageDriver({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: '  ' }),
    ).toThrow(/S3_ACCESS_KEY_ID is required/);
  });
});
