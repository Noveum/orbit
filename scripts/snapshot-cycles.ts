import { writeCycleSnapshots } from '../packages/core/src/analytics/snapshot.ts';
import { publishDeltas } from '../packages/core/src/realtime/publisher.ts';

async function main(): Promise<void> {
  const result = await writeCycleSnapshots();
  await publishDeltas(result.actions);
  console.info(
    `[snapshot-cycles] wrote ${result.count} cycle snapshot(s) for ${result.capturedOn}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[snapshot-cycles] failed', error);
    process.exit(1);
  });
