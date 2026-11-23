const WAITS_FOR_A_DESCRIPTION_UNLESS_EVERY_VALUE_IS_A_NUMBER =
  "if (!oids[i] && values[i] !== null && !(typeof values[i] === 'number' && isFinite(values[i])))";

const BINDS_TEXT_WITHOUT_WAITING_WHEN_TYPES_ARE_NOT_FETCHED =
  "if (!oids[i] && values[i] !== null && !(typeof values[i] === 'number' && isFinite(values[i])) && !(typeof values[i] === 'string' && options.fetch_types === false))";

export const DRIVER_CONNECTION_MODULE = /\/postgres\/src\/connection\.js$/;

export function sendParametersWithoutDescribing(source: string): string {
  const occurrences =
    source.split(WAITS_FOR_A_DESCRIPTION_UNLESS_EVERY_VALUE_IS_A_NUMBER).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected the Postgres driver to decide once whether a statement may bind before its description arrives, found ${occurrences} places. The driver changed: review the rewrite in driver-round-trips.ts before building for Workers.`,
    );
  }
  return source.replace(
    WAITS_FOR_A_DESCRIPTION_UNLESS_EVERY_VALUE_IS_A_NUMBER,
    BINDS_TEXT_WITHOUT_WAITING_WHEN_TYPES_ARE_NOT_FETCHED,
  );
}
