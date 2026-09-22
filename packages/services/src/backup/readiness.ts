import {
  type RestoreRecoveryState,
  restoreRecoveryStateSchema,
  validationFailed,
} from '@orbit/shared';
import postgres from 'postgres';

export const RESTORE_ADVISORY_LOCK_ID = 5_715_707_767_355_208;

export interface RestoreLock {
  readonly release: () => Promise<void>;
}

export async function acquireRestoreLock(databaseUrl: string): Promise<RestoreLock> {
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 0,
    prepare: false,
    onnotice: (_notice) => undefined,
  });
  try {
    const [lockRow] = await sql<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${RESTORE_ADVISORY_LOCK_ID}) as locked
    `;
    if (lockRow?.locked !== true) {
      await sql.end({ timeout: 5 });
      throw validationFailed('Another restore operation is currently in progress.');
    }
    await sql`
      create table if not exists public.orbit_recovery_state (
        id text primary key,
        status text not null check (status in ('restoring', 'validation_failed', 'ready')),
        error text,
        updated_at timestamptz not null default now()
      )
    `;
    await sql`
      insert into public.orbit_recovery_state (id, status, error, updated_at)
      values ('readiness', 'restoring', null, now())
      on conflict (id) do update set
        status = 'restoring',
        error = null,
        updated_at = now()
    `;
    return {
      release: async () => {
        try {
          await sql`select pg_advisory_unlock(${RESTORE_ADVISORY_LOCK_ID})`.catch(() => undefined);
        } finally {
          await sql.end({ timeout: 5 });
        }
      },
    };
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
}

export async function setRecoveryState(
  databaseUrl: string,
  status: 'restoring' | 'validation_failed' | 'ready',
  errorMessage?: string | null,
): Promise<void> {
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    prepare: false,
    onnotice: (_notice) => undefined,
  });
  try {
    await sql`
      create table if not exists public.orbit_recovery_state (
        id text primary key,
        status text not null check (status in ('restoring', 'validation_failed', 'ready')),
        error text,
        updated_at timestamptz not null default now()
      )
    `;
    await sql`
      insert into public.orbit_recovery_state (id, status, error, updated_at)
      values ('readiness', ${status}, ${errorMessage ?? null}, now())
      on conflict (id) do update set
        status = excluded.status,
        error = excluded.error,
        updated_at = excluded.updated_at
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function getRecoveryState(databaseUrl: string): Promise<RestoreRecoveryState | null> {
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    prepare: false,
    onnotice: (_notice) => undefined,
  });
  try {
    const [rowExists] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'orbit_recovery_state'
      ) as exists
    `;
    if (rowExists?.exists !== true) {
      return null;
    }

    const [row] = await sql<
      { id: string; status: string; error: string | null; updated_at: string }[]
    >`
      select id, status, error, updated_at::text as updated_at
      from public.orbit_recovery_state
      where id = 'readiness'
    `;
    if (row === undefined) {
      return null;
    }

    return restoreRecoveryStateSchema.parse({
      id: row.id,
      status: row.status,
      error: row.error,
      updatedAt: row.updated_at,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
