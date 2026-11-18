import type { Transaction } from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

export const GITHUB_REPLACEMENT_TRANSACTION_BUDGET_MS = 5000;

export function assertGithubReplacementBudget(deadline: number | undefined): void {
  if (deadline !== undefined && performance.now() >= deadline) {
    throw conflict('The GitHub connection changed too slowly. Reconnect again.', {
      details: { reason: 'github_replacement_budget_exhausted' },
    });
  }
}

export async function withinGithubReplacementBudget<T>(
  database: Transaction,
  deadline: number | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (deadline === undefined) return await operation();
  assertGithubReplacementBudget(deadline);
  const remaining = Math.max(1, Math.floor(deadline - performance.now()));
  await database.execute(sql`select set_config('statement_timeout', ${String(remaining)}, true)`);
  assertGithubReplacementBudget(deadline);
  const result = await operation();
  assertGithubReplacementBudget(deadline);
  return result;
}

export function isGithubBindingConflict(error: unknown): boolean {
  const seen = new Set<Error>();
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    if (
      current instanceof postgres.PostgresError &&
      ['55P03', '57014', '23505'].includes(current.code)
    )
      return true;
    const cause = Object.getOwnPropertyDescriptor(current, 'cause');
    current = cause !== undefined && 'value' in cause ? cause.value : undefined;
  }
  return false;
}
