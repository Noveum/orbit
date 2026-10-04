import { createHash } from 'node:crypto';
import { internal, validationFailed } from '@orbit/shared';
import { assertSafeKey } from '../storage/key.ts';
import { openValidatedFile } from './checksums.ts';
import type { RestoreStorageOptions, RestoreStorageResult } from './types.ts';

async function isObjectAlreadyVerified(
  driver: RestoreStorageOptions['driver'],
  safeKey: string,
  expected: RestoreStorageOptions['expectedObjects'][number],
): Promise<boolean> {
  const targetBytes = expected.plaintextBytes ?? expected.bytes;
  const targetSha256 = expected.plaintextSha256 ?? expected.sha256;

  const existingStat = await driver.stat(safeKey);
  if (existingStat === null || existingStat.size !== targetBytes) {
    return false;
  }
  const existingData = await driver.get(safeKey);
  if (existingData === null) {
    return false;
  }
  const existingSha256 = createHash('sha256').update(existingData).digest('hex');
  return existingSha256.toLowerCase() === targetSha256.toLowerCase();
}

function decryptAndValidatePlaintext(
  data: Buffer,
  expected: RestoreStorageOptions['expectedObjects'][number],
  decrypt?: ((data: Buffer) => Buffer) | undefined,
): Buffer {
  if (
    (expected.plaintextBytes !== undefined || expected.plaintextSha256 !== undefined) &&
    decrypt === undefined
  ) {
    throw validationFailed(
      `Backup object "${expected.key}" is encrypted but no decryption cipher was provided.`,
    );
  }

  if (decrypt === undefined) {
    return data;
  }

  const decrypted = decrypt(data);
  if (expected.plaintextBytes !== undefined && decrypted.byteLength !== expected.plaintextBytes) {
    throw validationFailed(
      `Backup object "${expected.key}" plaintext size mismatch: expected ${expected.plaintextBytes} bytes, found ${decrypted.byteLength} bytes.`,
    );
  }
  if (expected.plaintextSha256 !== undefined) {
    const decSha256 = createHash('sha256').update(decrypted).digest('hex');
    if (decSha256.toLowerCase() !== expected.plaintextSha256.toLowerCase()) {
      throw validationFailed(
        `Backup object "${expected.key}" plaintext checksum mismatch: expected ${expected.plaintextSha256}, found ${decSha256}.`,
      );
    }
  }
  return decrypted;
}

async function readAndValidateBackupObject(
  objectsDir: string,
  safeKey: string,
  expected: RestoreStorageOptions['expectedObjects'][number],
  decrypt?: ((data: Buffer) => Buffer) | undefined,
): Promise<Buffer> {
  const handle = await openValidatedFile(objectsDir, safeKey);
  let data: Buffer;
  try {
    data = await handle.readFile();
  } finally {
    await handle.close();
  }

  if (data.byteLength !== expected.bytes) {
    throw validationFailed(
      `Backup object "${expected.key}" size mismatch: expected ${expected.bytes} bytes, found ${data.byteLength} bytes.`,
    );
  }
  const sourceSha256 = createHash('sha256').update(data).digest('hex');
  if (sourceSha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    throw validationFailed(
      `Backup object "${expected.key}" checksum mismatch: expected ${expected.sha256}, found ${sourceSha256}.`,
    );
  }

  return decryptAndValidatePlaintext(data, expected, decrypt);
}

export async function restoreStorageObjects(
  options: RestoreStorageOptions,
): Promise<RestoreStorageResult> {
  const { objectsDir, expectedObjects, driver, signal, decrypt } = options;

  let uploadedCount = 0;
  let verifiedCount = 0;

  for (const expected of expectedObjects) {
    if (signal?.aborted) {
      throw internal('Storage restore was aborted due to lock loss.');
    }

    const safeKey = assertSafeKey(expected.key);
    const contentType = expected.contentType ?? 'application/octet-stream';

    if (await isObjectAlreadyVerified(driver, safeKey, expected)) {
      verifiedCount += 1;
      continue;
    }

    const data = await readAndValidateBackupObject(objectsDir, safeKey, expected, decrypt);

    if (signal?.aborted) {
      throw internal('Storage restore was aborted due to lock loss.');
    }

    await driver.put(safeKey, data, contentType);
    uploadedCount += 1;
  }

  return { uploadedCount, verifiedCount };
}
