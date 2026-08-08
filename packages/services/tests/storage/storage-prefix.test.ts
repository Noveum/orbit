import { describe, expect, it, mock } from 'bun:test';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
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

function versionApiUnavailable(): Error {
  const error = new Error('Version listing is not implemented.');
  error.name = 'NotImplemented';
  return Object.assign(error, { $metadata: { httpStatusCode: 501 } });
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
      if (command instanceof ListObjectsV2Command) {
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
      }
      if (command instanceof ListObjectVersionsCommand) {
        return command.input.KeyMarker === undefined
          ? {
              $metadata: {},
              Versions: [
                { Key: 'org_1/a', VersionId: 'a_1', Size: 10 },
                { Key: 'org_1/a', VersionId: 'a_0', Size: 9 },
                { Key: 'org_1/b', VersionId: 'b_1', Size: 20 },
              ],
              IsTruncated: true,
              NextKeyMarker: 'org_1/a',
              NextVersionIdMarker: 'a_0',
            }
          : {
              $metadata: {},
              Versions: [{ Key: 'org_1/orphan', VersionId: 'orphan_1', Size: 30 }],
              DeleteMarkers: [{ Key: 'org_1/removed', VersionId: 'marker_1' }],
              IsTruncated: false,
            };
      }
      throw new Error('Unexpected command');
    });
    const driver = new S3StorageDriver(config, client);

    expect(await driver.summarizePrefix('org_1/')).toEqual({
      objects: 3,
      bytes: 60,
      versions: 4,
      versionBytes: 69,
    });
    expect(send).toHaveBeenCalledTimes(4);
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

  it('rejects a truncated response with an empty continuation token', async () => {
    const { client, send } = controlledClient((command) => {
      if (
        command instanceof ListObjectsV2Command &&
        command.input.ContinuationToken === undefined
      ) {
        return {
          $metadata: {},
          Contents: [{ Key: 'org_1/a', Size: 10 }],
          IsTruncated: true,
          NextContinuationToken: '',
        };
      }
      throw new Error('The empty continuation token was reused.');
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.summarizePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses current objects as the version inventory when the provider has no version API', async () => {
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          $metadata: {},
          Contents: [{ Key: 'org_1/a', Size: 10 }],
          IsTruncated: false,
        };
      }
      throw versionApiUnavailable();
    });
    const driver = new S3StorageDriver(config, client);

    expect(await driver.summarizePrefix('org_1/')).toEqual({
      objects: 1,
      bytes: 10,
      versions: 1,
      versionBytes: 10,
    });
  });

  it('rejects a truncated version response without its next key marker', async () => {
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return { $metadata: {}, Contents: [], IsTruncated: false };
      }
      return {
        $metadata: {},
        Versions: [{ Key: 'org_1/a', VersionId: 'version_1', Size: 10 }],
        IsTruncated: true,
        NextVersionIdMarker: 'version_1',
      };
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.summarizePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
  });

  it('rejects a truncated version response without its next version marker', async () => {
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return { $metadata: {}, Contents: [], IsTruncated: false };
      }
      return {
        $metadata: {},
        Versions: [{ Key: 'org_1/a', VersionId: 'version_1', Size: 10 }],
        IsTruncated: true,
        NextKeyMarker: 'org_1/a',
      };
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.summarizePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
  });

  it('rejects a truncated version response with an empty marker', async () => {
    const { client, send } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return { $metadata: {}, Contents: [], IsTruncated: false };
      }
      if (command instanceof ListObjectVersionsCommand && command.input.KeyMarker === undefined) {
        return {
          $metadata: {},
          Versions: [{ Key: 'org_1/a', VersionId: 'version_1', Size: 10 }],
          IsTruncated: true,
          NextKeyMarker: '',
          NextVersionIdMarker: 'version_1',
        };
      }
      throw new Error('The empty version marker was reused.');
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.summarizePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
    expect(send).toHaveBeenCalledTimes(2);
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
      if (command instanceof ListObjectVersionsCommand) {
        return { $metadata: {}, Versions: [], DeleteMarkers: [], IsTruncated: false };
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

  it('permanently deletes historical versions and delete markers under the exact prefix', async () => {
    const deleted: { Key?: string | undefined; VersionId?: string | undefined }[][] = [];
    let versionLists = 0;
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return { $metadata: {}, Contents: [], IsTruncated: false };
      }
      if (command instanceof ListObjectVersionsCommand) {
        versionLists += 1;
        return versionLists === 1
          ? {
              $metadata: {},
              Versions: [
                { Key: 'org_1/file', VersionId: 'version_1' },
                { Key: 'org_1/file', VersionId: 'version_2' },
              ],
              DeleteMarkers: [{ Key: 'org_1/removed', VersionId: 'marker_1' }],
              IsTruncated: false,
            }
          : { $metadata: {}, Versions: [], DeleteMarkers: [], IsTruncated: false };
      }
      if (command instanceof DeleteObjectsCommand) {
        deleted.push([...(command.input.Delete?.Objects ?? [])]);
        return { $metadata: {}, Errors: [] };
      }
      throw new Error('Unexpected command');
    });
    const driver = new S3StorageDriver(config, client);

    await driver.deletePrefix('org_1/');

    expect(deleted.flat()).toEqual([
      { Key: 'org_1/file', VersionId: 'version_1' },
      { Key: 'org_1/file', VersionId: 'version_2' },
      { Key: 'org_1/removed', VersionId: 'marker_1' },
    ]);
    expect(versionLists).toBe(2);
  });

  it('supports providers without an object-version listing API', async () => {
    const { client, send } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return { $metadata: {}, Contents: [], IsTruncated: false };
      }
      if (command instanceof ListObjectVersionsCommand) {
        throw versionApiUnavailable();
      }
      throw new Error('Unexpected command');
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.deletePrefix('org_1/')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports a version deletion error instead of claiming permanent cleanup', async () => {
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return { $metadata: {}, Contents: [], IsTruncated: false };
      }
      if (command instanceof ListObjectVersionsCommand) {
        return {
          $metadata: {},
          Versions: [{ Key: 'org_1/file', VersionId: 'version_1' }],
          IsTruncated: false,
        };
      }
      return {
        $metadata: {},
        Errors: [{ Key: 'org_1/file', VersionId: 'version_1', Code: 'AccessDenied' }],
      };
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.deletePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
  });

  it('refuses a historical version outside the requested prefix', async () => {
    const { client } = controlledClient((command) => {
      if (command instanceof ListObjectsV2Command) {
        return { $metadata: {}, Contents: [], IsTruncated: false };
      }
      return {
        $metadata: {},
        Versions: [{ Key: 'org_2/secret', VersionId: 'version_1' }],
        IsTruncated: false,
      };
    });
    const driver = new S3StorageDriver(config, client);

    await expect(driver.deletePrefix('org_1/')).rejects.toMatchObject({ code: 'internal' });
  });

  it('treats an already empty prefix as a successful idempotent cleanup', async () => {
    const { client, send } = controlledClient(() => ({
      $metadata: {},
      Contents: [],
      IsTruncated: false,
    }));
    const driver = new S3StorageDriver(config, client);

    await expect(driver.deletePrefix('org_1/')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(ListObjectVersionsCommand);
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
