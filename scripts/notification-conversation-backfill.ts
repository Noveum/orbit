import { db, pool } from '../packages/db/src/index.ts';
import {
  CONVERSATION_BACKFILL_PHASES,
  type ConversationBackfillPhase,
  runNotificationConversationBackfill,
} from '../packages/services/src/notifications/index.ts';

const args = process.argv.slice(2);
const argumentNames = [
  'organization',
  'phase',
  'batch-size',
  'max-batches',
  'max-equivalence-group-rows',
  'source-concurrency',
] as const;

for (const value of args) {
  if (value === '--all') continue;
  if (!argumentNames.some((name) => value.startsWith(`--${name}=`))) {
    throw new Error(`Unknown notification conversation backfill argument "${value}".`);
  }
}

function valuesFor(name: string): string[] {
  const prefix = `--${name}=`;
  const values = args
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length));
  if (values.some((value) => value.length === 0)) {
    throw new Error(`--${name} cannot be empty.`);
  }
  return values;
}

function positiveInteger(name: string): number | undefined {
  const values = valuesFor(name);
  if (values.length > 1) throw new Error(`--${name} can be passed only once.`);
  const [raw] = values;
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return value;
}

function phases(): ConversationBackfillPhase[] | undefined {
  const requested = valuesFor('phase');
  if (requested.length === 0) return undefined;
  const allowed = new Set<string>(CONVERSATION_BACKFILL_PHASES);
  for (const phase of requested) {
    if (!allowed.has(phase)) {
      throw new Error(`--phase must be one of ${CONVERSATION_BACKFILL_PHASES.join(', ')}.`);
    }
  }
  return [...new Set(requested)] as ConversationBackfillPhase[];
}

async function main(): Promise<void> {
  const organizationIds = valuesFor('organization');
  if (args.includes('--all') === organizationIds.length > 0) {
    throw new Error('Choose --all or at least one --organization, never both.');
  }
  const requestedPhases = phases();
  const batchSize = positiveInteger('batch-size');
  const maxBatches = positiveInteger('max-batches');
  const maxEquivalenceGroupRows = positiveInteger('max-equivalence-group-rows');
  const sourceConcurrency = positiveInteger('source-concurrency');
  const result = await runNotificationConversationBackfill(db, {
    ...(organizationIds.length === 0 ? {} : { organizationIds }),
    ...(requestedPhases === undefined ? {} : { phases: requestedPhases }),
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(maxBatches === undefined ? {} : { maxBatches }),
    ...(maxEquivalenceGroupRows === undefined ? {} : { maxEquivalenceGroupRows }),
    ...(sourceConcurrency === undefined ? {} : { sourceConcurrency }),
  });
  console.log(JSON.stringify(result, null, 2));
}

try {
  await main();
} finally {
  await pool.end();
}
