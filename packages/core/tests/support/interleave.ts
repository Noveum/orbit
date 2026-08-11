import postgres from 'postgres';

const POLL_INTERVAL_MS = 10;
const WAIT_TIMEOUT_MS = 10_000;

export type RawClient = ReturnType<typeof postgres>;

export interface LockCrossing<T> {
  readonly organizationId: string;
  readonly race: () => Promise<T>;
  readonly interlope: (client: RawClient) => Promise<void>;
}

function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is not set, so no second connection can be opened.');
  }
  return url;
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function queuedBehindAnAdvisoryLock(client: RawClient): Promise<number> {
  const rows = await client<{ waiting: number }[]>`
    select count(*)::int as waiting
    from pg_locks
    where locktype = 'advisory'
      and not granted
      and database = (select oid from pg_database where datname = current_database())
  `;
  return rows[0]?.waiting ?? 0;
}

async function awaitOneWaiter(client: RawClient): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await queuedBehindAnAdvisoryLock(client)) > 0) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    'Nothing ever queued behind the team lock. The racing call either finished without taking it or never reached it.',
  );
}

export async function raceAcrossCycleLock<T>(
  crossing: LockCrossing<T>,
): Promise<PromiseSettledResult<T>> {
  const client = postgres(requireDatabaseUrl(), {
    max: 1,
    idle_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    await client.unsafe('begin');
    await client`select pg_advisory_xact_lock(hashtext(${`cycle:${crossing.organizationId}`}))`;
    const racing = settle(crossing.race());
    try {
      await awaitOneWaiter(client);
      await crossing.interlope(client);
      await client.unsafe('commit');
    } finally {
      await client.unsafe('rollback').catch(() => undefined);
      await racing;
    }
    return await racing;
  } finally {
    await client.end();
  }
}
