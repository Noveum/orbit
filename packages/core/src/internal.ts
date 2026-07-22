import { randomUUID } from 'node:crypto';
import type { Database, Transaction } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';

export type Executor = Database | Transaction;

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
}

export function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) throw notFound(message);
  return row;
}

export function toDateString(value: Date | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.toISOString().slice(0, 10);
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}
