import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization, team } from './org.ts';
import { cycle, issue } from './work.ts';

export const standup = pgTable(
  'standup',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    cycleId: text('cycle_id').references(() => cycle.id, { onDelete: 'set null' }),
    heldOn: date('held_on').notNull(),
    facilitatorId: text('facilitator_id').references(() => user.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('scheduled'),
    currentTurnId: text('current_turn_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('standup_team_day_unique').on(table.teamId, table.heldOn),
    index('standup_org_day_idx').on(table.organizationId, table.heldOn),
    index('standup_cycle_idx').on(table.cycleId),
  ],
);

export const standupTurn = pgTable(
  'standup_turn',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    standupId: text('standup_id')
      .notNull()
      .references(() => standup.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    attendance: text('attendance').notNull().default('unknown'),
    status: text('status').notNull().default('waiting'),
    notes: text('notes').notNull().default(''),
    blockers: text('blockers').notNull().default(''),
    spokeAt: timestamp('spoke_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('standup_turn_person_unique').on(table.standupId, table.userId),
    index('standup_turn_order_idx').on(table.standupId, table.position),
  ],
);

export const standupBlocker = pgTable(
  'standup_blocker',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    turnId: text('turn_id')
      .notNull()
      .references(() => standupTurn.id, { onDelete: 'cascade' }),
    issueId: text('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('standup_blocker_turn_idx').on(table.turnId),
    index('standup_blocker_issue_idx').on(table.issueId),
  ],
);

export const standupRotation = pgTable(
  'standup_rotation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    facilitates: smallint('facilitates').notNull().default(1),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('standup_rotation_member_unique').on(table.teamId, table.userId),
    index('standup_rotation_order_idx').on(table.teamId, table.position),
  ],
);
