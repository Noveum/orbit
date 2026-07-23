import { DomainError, MAX_UPLOAD_BYTES } from '@orbit/shared';
import { describe, expect, it } from 'vitest';
import {
  assertSafeKey,
  createStorageDriver,
  kindOf,
  S3StorageDriver,
  sanitizeFileName,
  storageKeyFor,
  validateUpload,
} from './index.ts';

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

describe('assertSafeKey', () => {
  it('rejects keys that escape their prefix', () => {
    const escapes = [
      '../outside.txt',
      'org/../../outside.txt',
      '/etc/passwd',
      'a/./../../b.txt',
      '..',
      '',
      'a\\b.txt',
    ];
    for (const key of escapes) {
      expect(() => assertSafeKey(key)).toThrow(DomainError);
    }
  });

  it('collapses harmless traversal', () => {
    expect(assertSafeKey('org/sub/../file.txt')).toBe('org/file.txt');
    expect(assertSafeKey('org/2026/03/a.png')).toBe('org/2026/03/a.png');
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
  it('builds an s3 driver from explicit keys and endpoint', () => {
    expect(
      createStorageDriver({
        S3_BUCKET: 'orbit-uploads',
        S3_ACCESS_KEY_ID: 'orbitminio',
        S3_SECRET_ACCESS_KEY: 'orbitminio',
        S3_ENDPOINT: 'http://localhost:9010',
      }).name,
    ).toBe('s3');
  });

  it('builds an s3 driver with no keys so the pod role supplies them', () => {
    expect(createStorageDriver({ S3_BUCKET: 'orbit-uploads' }).name).toBe('s3');
  });

  it('requires a bucket', () => {
    expect(() => createStorageDriver({})).toThrow(/S3_BUCKET is required/);
  });

  it('rejects a half configured key pair', () => {
    expect(() =>
      createStorageDriver({ S3_BUCKET: 'orbit-uploads', S3_ACCESS_KEY_ID: 'only-the-id' }),
    ).toThrow(DomainError);
    expect(() =>
      createStorageDriver({ S3_BUCKET: 'orbit-uploads', S3_SECRET_ACCESS_KEY: 'only-the-secret' }),
    ).toThrow(DomainError);
  });
});
