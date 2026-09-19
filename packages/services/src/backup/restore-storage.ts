import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeKey } from '../storage/key.ts';
import type { RestoreStorageOptions, RestoreStorageResult } from './types.ts';

export async function restoreStorageObjects(
  options: RestoreStorageOptions,
): Promise<RestoreStorageResult> {
  const { objectsDir, expectedObjects, driver } = options;

  let uploadedCount = 0;
  let verifiedCount = 0;

  for (const expected of expectedObjects) {
    const safeKey = assertSafeKey(expected.key);
    const sourcePath = join(objectsDir, safeKey);
    const data = await readFile(sourcePath);
    const contentType = expected.contentType ?? 'application/octet-stream';

    const existingStat = await driver.stat(safeKey);
    if (existingStat === null || existingStat.size !== expected.bytes) {
      await driver.put(safeKey, data, contentType);
      uploadedCount += 1;
      continue;
    }

    const existingData = await driver.get(safeKey);
    if (existingData === null) {
      await driver.put(safeKey, data, contentType);
      uploadedCount += 1;
      continue;
    }

    const existingSha256 = createHash('sha256').update(existingData).digest('hex');
    if (existingSha256.toLowerCase() === expected.sha256.toLowerCase()) {
      verifiedCount += 1;
    } else {
      await driver.put(safeKey, data, contentType);
      uploadedCount += 1;
    }
  }

  return { uploadedCount, verifiedCount };
}
