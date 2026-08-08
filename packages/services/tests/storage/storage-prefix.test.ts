import { describe, expect, it, mock } from 'bun:test';
import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { DomainError } from '@orbit/shared';
import * as storage from '../../src/storage/index.ts';

const expectedStorage = storage as typeof storage & {
  readonly assertSafePrefix: (prefix: string) => string;
  readonly storagePrefixFor: (organizationId: string) => string;
};
const { assertSafePrefix, storagePrefixFor } = expectedStorage;
const { S3StorageDriver } = storage;

const config = {
  bucket: 'orbit-uploads',
  region: 'us-east-1',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
};

function controlledClient(send: (command: unknown) => unknown): {
  readonly client: S3Client;
  readonly send: ReturnType<typeof mock>;
} {
  const recorded = mock((command: unknown) => Promise.resolve(send(command)));
  return { client: { send: recorded } as unknown as S3Client, send: recorded };
}

describe('organization storage prefixes', () => {
  it('derives one exact prefix from an organization id', () => {
    expect(storagePrefixFor('org_1')).toBe('org_1/');
  });

  it('rejects prefixes that are empty, broad, traversing, or not terminated', () => {
    for (const prefix of ['', '/', '../', 'org_1', 'org_1/../', 'org_1\\']) {
      expect(() => assertSafePrefix(prefix), prefix).toThrow(DomainError);
    }
  });
});

describe('S3StorageDriver prefix summary', () => {
  it('paginates every stored object and totals bytes independently of attachment rows', async () => {
    const { client, send } = controlledClient((command) => {
      if (!(command instanceof ListObjectsV2Command)) throw new Error('Unexpected command');
      if (command.input.ContinuationToken === undefined) {
        return {
          $metadata: {},
          Contents: [
            { Key: 'org_1/a', Size: 10 },
            { Key: 'org_1/b', Size: 20 },
          ],
          IsTruncated: true,
          NextContinuationToken: 'page_2',
        };
      }
      expect(command.input.ContinuationToken).toBe('page_2');
      return {
        $metadata: {},
        Contents: [{ Key: 'org_1/orphan', Size: 30 }],
        IsTruncated: false,
      };
    });
    const driver = new S3StorageDriver(config, client);

    expect(await driver.summarizePrefix('org_1/')).toEqual({ objects: 3, bytes: 60 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects a truncated response without a continuation token', async () => {
    const { client } = controlledClient(() => ({
      $metadata: {},
      Contents: [{ Key: 'org_1/a', Size: 10 }],
      IsTruncated: true,
    }));
    const driver = new S3StorageDriver(config, client);

    await expect(driver.summarizePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('S3StorageDriver prefix deletion', () => {
  it('deletes exact listed keys in S3 batches and proves the prefix is empty', async () => {
    const keys = Array.from({ length: 1001 }, (_, index) => `org_1/file_${String(index)}`);
    const deleted: string[][] = [];
    let listCalls = 0;
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        listCalls += 1;
        return {
          $metadata: {},
          Contents: listCalls === 1 ? keys.map((Key) => ({ Key, Size: 1 })) : [],
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectsCommand) {
        deleted.push((command.input.Delete?.Objects ?? []).map((entry) => entry.Key ?? ''));
        return { $metadata: {}, Deleted: command.input.Delete?.Objects ?? [], Errors: [] };
      }
      throw new Error('Unexpected command');
    });
    const driver = new S3StorageDriver(config, client);

    await driver.deletePrefix('org_1/');

    expect(deleted.map((batch) => batch.length)).toEqual([1000, 1]);
    expect(deleted.flat()).toEqual(keys);
    expect(listCalls).toBe(2);
  });

  it('treats an already empty prefix as a successful idempotent cleanup', async () => {
    const { client, send } = controlledClient(() => ({
      $metadata: {},
      Contents: [],
      IsTruncated: false,
    }));
    const driver = new S3StorageDriver(config, client);

    await expect(driver.deletePrefix('org_1/')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectsV2Command);
  });

  it('reports a per-object deletion error instead of claiming success', async () => {
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          $metadata: {},
          Contents: [{ Key: 'org_1/stuck', Size: 7 }],
          IsTruncated: false,
        };
      }
      return {
        $metadata: {},
        Deleted: [],
        Errors: [{ Key: 'org_1/stuck', Code: 'AccessDenied', Message: 'denied' }],
      };
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.deletePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
  });

  it('refuses a key outside the requested prefix even if storage returns it', async () => {
    const { client } = controlledClient(() => ({
      $metadata: {},
      Contents: [{ Key: 'org_2/secret', Size: 9 }],
      IsTruncated: false,
    }));
    const driver = new S3StorageDriver(config, client);

    await expect(driver.deletePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
  });
});
