import postgres from 'postgres';
import type { AttachmentRecord } from './types.ts';

export interface DatabaseSnapshotSession {
  readonly snapshotId?: string | undefined;
  readonly records: readonly AttachmentRecord[];
  readonly counts: {
    readonly workspaces: number;
    readonly users: number;
    readonly attachments: number;
    readonly issues: number;
  };
  readonly release: () => Promise<void>;
}

export async function openCoordinatedSnapshot(url: string): Promise<DatabaseSnapshotSession> {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 10,
    prepare: false,
  });

  let snapshotId: string | undefined;
  let records: AttachmentRecord[] = [];
  let counts = { workspaces: 0, users: 0, attachments: 0, issues: 0 };
  let closeTransaction: (() => void) | undefined;

  const transactionPromise = new Promise<void>((resolveTransaction) => {
    closeTransaction = resolveTransaction;
  });

  const sessionReady = new Promise<void>((resolveSession, rejectSession) => {
    sql
      .begin(async (tx) => {
        try {
          await tx.unsafe('set transaction isolation level repeatable read read only');
          try {
            const [snapRow] = await tx<{ snapshot: string }[]>`
              select pg_export_snapshot() as snapshot
            `;
            snapshotId = snapRow?.snapshot;
          } catch {
            snapshotId = undefined;
          }

          records = await tx<AttachmentRecord[]>`
            select id, storage_key, size, content_type
            from attachment
            where status = 'ready'
            order by id
          `;

          const [orgRow] = await tx<{ count: number }[]>`
            select count(*)::int as count from organization
          `;
          const [userRow] = await tx<{ count: number }[]>`
            select count(*)::int as count from "user"
          `;
          const [attRow] = await tx<{ count: number }[]>`
            select count(*)::int as count from attachment
          `;
          const [issueRow] = await tx<{ count: number }[]>`
            select count(*)::int as count from issue
          `;

          counts = {
            workspaces: orgRow?.count ?? 0,
            users: userRow?.count ?? 0,
            attachments: attRow?.count ?? 0,
            issues: issueRow?.count ?? 0,
          };

          resolveSession();
        } catch (error) {
          rejectSession(error);
          return;
        }

        await transactionPromise;
      })
      .catch((error) => {
        rejectSession(error);
      });
  });

  await sessionReady;

  return {
    snapshotId,
    records,
    counts,
    async release() {
      if (closeTransaction !== undefined) {
        closeTransaction();
      }
      await sql.end({ timeout: 5 }).catch(() => undefined);
    },
  };
}
