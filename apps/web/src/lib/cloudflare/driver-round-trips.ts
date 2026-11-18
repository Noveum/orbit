const DESCRIBES_EVERY_NEW_STATEMENT =
  'q.describeFirst = q.onlyDescribe || (parameters.length && !q.prepared)';

const DESCRIBES_ONLY_WHEN_TYPES_ARE_FETCHED =
  'q.describeFirst = q.onlyDescribe || (parameters.length && !q.prepared && options.fetch_types !== false)';

export const DRIVER_CONNECTION_MODULE = /\/postgres\/cf\/src\/connection\.js$/;

export function sendParametersWithoutDescribing(source: string): string {
  const occurrences = source.split(DESCRIBES_EVERY_NEW_STATEMENT).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected the Postgres driver to decide once whether to describe a statement before binding it, found ${occurrences} places. The driver changed: review the rewrite in driver-round-trips.ts before building for Workers.`,
    );
  }
  return source.replace(DESCRIBES_EVERY_NEW_STATEMENT, DESCRIBES_ONLY_WHEN_TYPES_ARE_FETCHED);
}
