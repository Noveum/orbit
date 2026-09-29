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
  const existingStat = await driver.stat(safeKey);
  if (existingStat === null || existingStat.size !== expected.bytes) {
    return false;
  }
  const existingData = await driver.get(safeKey);
  if (existingData === null) {
    return false;
  }
  const existingSha256 = createHash('sha256').update(existingData).digest('hex');
  return existingSha256.toLowerCase() === expected.sha256.toLowerCase();
}

async function readAndValidateBackupObject(
  objectsDir: string,
  safeKey: string,
  expected: RestoreStorageOptions['expectedObjects'][number],
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
  return data;
}

export async function restoreStorageObjects(
  options: RestoreStorageOptions,
): Promise<RestoreStorageResult> {
  const { objectsDir, expectedObjects, driver, signal } = options;

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

    const data = await readAndValidateBackupObject(objectsDir, safeKey, expected);

    if (signal?.aborted) {
      throw internal('Storage restore was aborted due to lock loss.');
    }

    await driver.put(safeKey, data, contentType);
    uploadedCount += 1;
  }

  return { uploadedCount, verifiedCount };
}
