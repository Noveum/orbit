import { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export interface CatalogColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultExpression: string;
  readonly generatedExpression: string;
}

export interface CatalogIndex {
  readonly name: string;
  readonly unique: boolean;
  readonly method: string;
  readonly columns: readonly string[];
  readonly predicate: string;
}

export interface CatalogForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly foreignTable: string;
  readonly foreignColumns: readonly string[];
  readonly onDelete: string;
  readonly onUpdate: string;
}

export interface CatalogCheckConstraint {
  readonly name: string;
  readonly expression: string;
}

export interface CatalogTable {
  readonly name: string;
  readonly columns: readonly CatalogColumn[];
  readonly primaryKey: readonly string[];
  readonly indexes: readonly CatalogIndex[];
  readonly foreignKeys: readonly CatalogForeignKey[];
  readonly checks: readonly CatalogCheckConstraint[];
}

export interface CatalogEnum {
  readonly name: string;
  readonly values: readonly string[];
}

export interface CatalogFunction {
  readonly name: string;
  readonly identityArguments: string;
  readonly returnType: string;
  readonly language: string;
  readonly definition: string;
}

export interface CatalogTrigger {
  readonly table: string;
  readonly name: string;
  readonly definition: string;
  readonly enabled: string;
}

export interface Catalog {
  readonly tables: readonly CatalogTable[];
  readonly enums: readonly CatalogEnum[];
  readonly functions?: readonly CatalogFunction[];
  readonly triggers?: readonly CatalogTrigger[];
}

export interface ColumnMismatch {
  readonly table: string;
  readonly column: string;
  readonly property: 'type' | 'nullability' | 'default' | 'generated';
  readonly expected: string;
  readonly actual: string;
}

export interface NamedMismatch {
  readonly table: string;
  readonly name: string;
  readonly expected: string;
  readonly actual: string;
}

export interface FunctionMismatch {
  readonly name: string;
  readonly expected: string;
  readonly actual: string;
}

export interface Drift {
  readonly missingTables: string[];
  readonly missingColumns: { table: string; column: string }[];
  readonly columnMismatches: ColumnMismatch[];
  readonly primaryKeyMismatches: NamedMismatch[];
  readonly missingIndexes: { table: string; index: string }[];
  readonly indexMismatches: NamedMismatch[];
  readonly missingForeignKeys: { table: string; foreignKey: string }[];
  readonly foreignKeyMismatches: NamedMismatch[];
  readonly missingChecks: { table: string; check: string }[];
  readonly checkMismatches: NamedMismatch[];
  readonly missingEnums: string[];
  readonly enumMismatches: { name: string; expected: string; actual: string }[];
  readonly missingFunctions: string[];
  readonly functionMismatches: FunctionMismatch[];
  readonly missingTriggers: { table: string; trigger: string }[];
  readonly triggerMismatches: NamedMismatch[];
  readonly undeclaredTables: string[];
  readonly undeclaredIndexes: { table: string; index: string }[];
  readonly undeclaredForeignKeys: { table: string; foreignKey: string }[];
  readonly undeclaredChecks: { table: string; check: string }[];
  readonly undeclaredFunctions: string[];
  readonly undeclaredTriggers: { table: string; trigger: string }[];
}

interface PgEnumLike {
  readonly enumName: string;
  readonly enumValues: readonly string[];
}

const dialect = new PgDialect();

function isPgTable(value: unknown): value is PgTable {
  if (typeof value !== 'object' || value === null) return false;
  try {
    getTableConfig(value as PgTable);
    return true;
  } catch {
    return false;
  }
}

function isPgEnum(value: unknown): value is PgEnumLike {
  if (typeof value !== 'function') return false;
  const candidate = value as unknown as { enumName?: unknown; enumValues?: unknown };
  return typeof candidate.enumName === 'string' && Array.isArray(candidate.enumValues);
}

function normalizeSqlCaseAndIdentifiers(value: string): string {
  let normalized = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'" && quoted && value[index + 1] === "'") {
      normalized += "''";
      index += 1;
      continue;
    }
    if (character === "'") {
      quoted = !quoted;
      normalized += character;
      continue;
    }
    if (!quoted && character === '"') continue;
    normalized += quoted ? character : character?.toLowerCase();
  }
  return normalized;
}

function normalizeSql(value: string): string {
  return normalizeSqlCaseAndIdentifiers(value)
    .replace(/\b[a-z_][a-z0-9_]*\./g, '')
    .replace(
      /::[a-z_][a-z0-9_]*(?:\s*\([^)]*\))?(?:\s+(?:with(?:out)?\s+time\s+zone|precision|varying))?(?:\[\])?/g,
      '',
    )
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function enclosedInOuterParentheses(value: string): boolean {
  if (!(value.startsWith('(') && value.endsWith(')'))) return false;
  const structural = value.replace(/'(?:''|[^'])*'/g, '');
  let depth = 0;
  for (let index = 0; index < structural.length; index += 1) {
    const character = structural[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && index < structural.length - 1) return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export function normalizeCatalogExpression(value: string): string {
  const normalized = normalizeSqlCaseAndIdentifiers(value)
    .replace(/::[a-z_][a-z0-9_]*(?:\s+[a-z_][a-z0-9_]*)?(?:\[\])?/g, '')
    .replace(/interval '(\d+) seconds'/g, (_match, seconds: string) => {
      const total = Number(seconds);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const remainder = total % 60;
      return `'${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}'`;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return enclosedInOuterParentheses(normalized) ? normalized.slice(1, -1).trim() : normalized;
}

function quotedLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function expectedDefaultExpression(value: unknown): string {
  if (value === undefined) return '';
  if (value instanceof SQL) return normalizeCatalogExpression(dialect.sqlToQuery(value).sql);
  if (typeof value === 'string') return normalizeCatalogExpression(quotedLiteral(value));
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return normalizeCatalogExpression(String(value));
  }
  if (value instanceof Date) return normalizeCatalogExpression(quotedLiteral(value.toISOString()));
  return normalizeCatalogExpression(quotedLiteral(JSON.stringify(value)));
}

function expectedGeneratedExpression(value: PgTable['_']['columns'][string]): string {
  const generated = value.generated;
  if (generated === undefined) return '';
  const expression = typeof generated.as === 'function' ? generated.as() : generated.as;
  if (expression instanceof SQL) {
    return normalizeCatalogExpression(dialect.sqlToQuery(expression).sql);
  }
  return normalizeCatalogExpression(String(expression));
}

function expectedIndexColumn(value: unknown): string {
  const named = value as { name?: unknown };
  if (typeof named.name === 'string') return named.name;
  return normalizeSql(dialect.sqlToQuery(value as SQL).sql);
}

function postgresIdentifier(value: string): string {
  return value.slice(0, 63);
}

function stableIndex(index: CatalogIndex): string {
  return JSON.stringify({
    unique: index.unique,
    method: index.method,
    columns: index.columns.map(normalizeSql),
    predicate: normalizeSql(index.predicate),
  });
}

function stableForeignKey(foreignKey: CatalogForeignKey): string {
  return JSON.stringify({
    columns: foreignKey.columns,
    foreignTable: foreignKey.foreignTable,
    foreignColumns: foreignKey.foreignColumns,
    onDelete: foreignKey.onDelete,
    onUpdate: foreignKey.onUpdate,
  });
}

function stableCheck(check: CatalogCheckConstraint): string {
  const normalized = normalizeSqlCaseAndIdentifiers(check.expression).replace(
    /('(?:''|[^'])*')::text\b/g,
    '$1',
  );
  return canonicalBooleanExpression(normalized);
}

function canonicalBooleanExpression(expression: string): string {
  let value = expression.trim();
  while (enclosedInOuterParentheses(value)) value = value.slice(1, -1).trim();
  const tokens =
    value.match(/'(?:''|[^'])*'|\(|\)|\b(?:and|or)\b|[^'()]+?(?=\b(?:and|or)\b|['()]|$)/g) ?? [];
  for (const operator of ['or', 'and']) {
    let depth = 0;
    const parts: string[] = [];
    let part = '';
    for (const token of tokens) {
      if (token === '(') depth += 1;
      if (token === ')') depth -= 1;
      if (depth === 0 && token === operator) {
        parts.push(part);
        part = '';
      } else {
        part += token;
      }
    }
    if (parts.length > 0) {
      parts.push(part);
      return `${operator}(${parts.map(canonicalBooleanExpression).join(',')})`;
    }
  }
  return value
    .split(/('(?:''|[^'])*')/g)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/\b[a-z_][a-z0-9_]*\./g, '').replace(/\s+/g, ' '),
    )
    .join('')
    .trim();
}

function normalizeFunctionDefinition(value: string): string {
  const body = value.match(/\bas\s+(\$[^$]*\$)([\s\S]*?)\1\s*$/iu)?.[2] ?? value;
  return normalizeSqlCaseAndIdentifiers(body)
    .split(/('(?:''|[^'])*')/g)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/\bpublic\./g, '')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTriggerDefinition(value: string): string {
  return normalizeSqlCaseAndIdentifiers(value)
    .replace(/\bpublic\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableFunction(value: CatalogFunction): string {
  return JSON.stringify({
    identityArguments: value.identityArguments,
    returnType: value.returnType,
    language: value.language,
    definition: normalizeFunctionDefinition(value.definition),
  });
}

function functionIdentity(value: CatalogFunction): string {
  return `${value.name}(${value.identityArguments})`;
}

function stableTrigger(value: CatalogTrigger): string {
  return JSON.stringify({
    definition: normalizeTriggerDefinition(value.definition),
    enabled: value.enabled,
  });
}

const expectedLifecycleFunctions: readonly CatalogFunction[] = [
  {
    name: 'agent_identity_lifecycle_guard',
    identityArguments: '',
    returnType: 'trigger',
    language: 'plpgsql',
    definition: `
      BEGIN
        IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
          OR NEW."client_id" IS DISTINCT FROM OLD."client_id"
          OR (NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id" AND NOT (
            OLD."deleted_at" IS NOT NULL AND NEW."owner_user_id" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = OLD."owner_user_id")
          )) THEN
          RAISE EXCEPTION 'agent identity binding is immutable';
        END IF;
        IF OLD."deleted_at" IS NOT NULL AND (
          NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
          OR NEW."deleted_reason" IS DISTINCT FROM OLD."deleted_reason"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
          OR NEW."last_acted_at" IS DISTINCT FROM OLD."last_acted_at"
          OR NEW."name" IS DISTINCT FROM OLD."name"
          OR NEW."avatar" IS DISTINCT FROM OLD."avatar"
          OR NEW."owner_name_snapshot" IS DISTINCT FROM OLD."owner_name_snapshot"
          OR NEW."client_name_snapshot" IS DISTINCT FROM OLD."client_name_snapshot"
          OR NEW."owner_disabled_actor_id_snapshot" IS DISTINCT FROM OLD."owner_disabled_actor_id_snapshot"
          OR NEW."owner_resumed_actor_id_snapshot" IS DISTINCT FROM OLD."owner_resumed_actor_id_snapshot"
          OR NEW."admin_disabled_actor_id_snapshot" IS DISTINCT FROM OLD."admin_disabled_actor_id_snapshot"
          OR NEW."admin_resumed_actor_id_snapshot" IS DISTINCT FROM OLD."admin_resumed_actor_id_snapshot"
          OR NEW."connection_revoked_actor_id_snapshot" IS DISTINCT FROM OLD."connection_revoked_actor_id_snapshot"
          OR NEW."deleted_actor_id_snapshot" IS DISTINCT FROM OLD."deleted_actor_id_snapshot"
        ) THEN
          RAISE EXCEPTION 'deleted agent identity is immutable';
        END IF;
        IF OLD."deleted_at" IS NULL AND NEW."owner_user_id" IS NULL THEN
          RAISE EXCEPTION 'active agent identity requires an owner';
        END IF;
        RETURN NEW;
      END;
    `,
  },
  {
    name: 'mcp_grant_lifecycle_guard',
    identityArguments: '',
    returnType: 'trigger',
    language: 'plpgsql',
    definition: `
      DECLARE identity_id text;
      BEGIN
        IF TG_TABLE_NAME = 'agent_identity' THEN
          identity_id := NEW.id;
        ELSE
          identity_id := NEW.agent_identity_id;
        END IF;
        PERFORM 1 FROM agent_identity WHERE id = identity_id FOR UPDATE;
        IF EXISTS (
          SELECT 1 FROM mcp_grant g
          JOIN agent_identity a ON a.id = g.agent_identity_id
          WHERE a.id = identity_id AND g.revoked_at IS NULL
            AND (a.deleted_at IS NOT NULL OR a.owner_disabled_at IS NOT NULL OR a.admin_disabled_at IS NOT NULL)
        ) THEN
          RAISE EXCEPTION 'active grant requires an active identity' USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END;
    `,
  },
];

const expectedLifecycleTriggers: readonly CatalogTrigger[] = [
  {
    table: 'agent_identity',
    name: 'agent_identity_lifecycle_guard_trigger',
    definition:
      'CREATE TRIGGER agent_identity_lifecycle_guard_trigger BEFORE UPDATE ON agent_identity FOR EACH ROW EXECUTE FUNCTION agent_identity_lifecycle_guard()',
    enabled: 'O',
  },
  {
    table: 'mcp_grant',
    name: 'mcp_grant_lifecycle_guard_trigger',
    definition:
      'CREATE CONSTRAINT TRIGGER mcp_grant_lifecycle_guard_trigger AFTER INSERT OR UPDATE ON mcp_grant DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcp_grant_lifecycle_guard()',
    enabled: 'O',
  },
  {
    table: 'agent_identity',
    name: 'agent_identity_active_grant_guard_trigger',
    definition:
      'CREATE CONSTRAINT TRIGGER agent_identity_active_grant_guard_trigger AFTER UPDATE ON agent_identity DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcp_grant_lifecycle_guard()',
    enabled: 'O',
  },
];

export function expectedCatalog(module: Record<string, unknown>): Catalog {
  const tables: CatalogTable[] = [];
  const enums: CatalogEnum[] = [];

  for (const value of Object.values(module)) {
    if (isPgEnum(value)) {
      enums.push({ name: value.enumName, values: [...value.enumValues] });
      continue;
    }
    if (!isPgTable(value)) continue;
    const config = getTableConfig(value);
    const indexes: CatalogIndex[] = config.indexes.map((entry) => ({
      name: entry.config.name ?? '',
      unique: entry.config.unique,
      method: entry.config.method ?? 'btree',
      columns: entry.config.columns.map(expectedIndexColumn),
      predicate: entry.config.where === undefined ? '' : dialect.sqlToQuery(entry.config.where).sql,
    }));
    for (const constraint of config.uniqueConstraints) {
      const name = constraint.getName();
      if (name === undefined)
        throw new Error(`An unnamed unique constraint exists on ${config.name}.`);
      indexes.push({
        name,
        unique: true,
        method: 'btree',
        columns: constraint.columns.map((column) => column.name),
        predicate: '',
      });
    }
    for (const column of config.columns) {
      if (!column.isUnique) continue;
      const name = column.uniqueName;
      if (name === undefined) throw new Error(`An unnamed unique column exists on ${config.name}.`);
      indexes.push({
        name,
        unique: true,
        method: 'btree',
        columns: [column.name],
        predicate: '',
      });
    }
    const inlinePrimary = config.columns
      .filter((column) => column.primary)
      .map((column) => column.name);
    const compositePrimary = config.primaryKeys.flatMap((key) =>
      key.columns.map((column) => column.name),
    );
    tables.push({
      name: config.name,
      columns: config.columns
        .map((column) => ({
          name: column.name,
          type: column.getSQLType(),
          notNull: column.notNull,
          defaultExpression: expectedDefaultExpression(column.default),
          generatedExpression: expectedGeneratedExpression(column),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      primaryKey: [...inlinePrimary, ...compositePrimary],
      indexes: indexes.sort((left, right) => left.name.localeCompare(right.name)),
      foreignKeys: config.foreignKeys
        .map((foreignKey) => {
          const reference = foreignKey.reference();
          return {
            name: postgresIdentifier(foreignKey.getName()),
            columns: reference.columns.map((column) => column.name),
            foreignTable: getTableConfig(reference.foreignTable).name,
            foreignColumns: reference.foreignColumns.map((column) => column.name),
            onDelete: foreignKey.onDelete ?? 'no action',
            onUpdate: foreignKey.onUpdate ?? 'no action',
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
      checks: config.checks
        .map((check) => ({ name: check.name, expression: dialect.sqlToQuery(check.value).sql }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    });
  }

  return {
    tables: tables.sort((left, right) => left.name.localeCompare(right.name)),
    enums: enums.sort((left, right) => left.name.localeCompare(right.name)),
    functions: [...expectedLifecycleFunctions].sort((left, right) =>
      functionIdentity(left).localeCompare(functionIdentity(right)),
    ),
    triggers: [...expectedLifecycleTriggers].sort((left, right) => {
      const tableOrder = left.table.localeCompare(right.table);
      return tableOrder === 0 ? left.name.localeCompare(right.name) : tableOrder;
    }),
  };
}

interface LiveColumnRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly column_type: string;
  readonly not_null: boolean;
  readonly default_expression: string | null;
  readonly generated_expression: string | null;
}

interface LivePrimaryKeyRow {
  readonly table_name: string;
  readonly columns: string[];
}

interface LiveIndexRow {
  readonly table_name: string;
  readonly index_name: string;
  readonly unique_index: boolean;
  readonly method: string;
  readonly columns: string[];
  readonly predicate: string | null;
}

interface LiveForeignKeyRow {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly columns: string[];
  readonly foreign_table: string;
  readonly foreign_columns: string[];
  readonly on_delete: string;
  readonly on_update: string;
}

interface LiveEnumRow {
  readonly enum_name: string;
  readonly values: string[];
}

interface LiveCheckRow {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly definition: string;
}

interface LiveFunctionRow {
  readonly function_name: string;
  readonly identity_arguments: string;
  readonly return_type: string;
  readonly language: string;
  readonly definition: string;
}

interface LiveTriggerRow {
  readonly table_name: string;
  readonly trigger_name: string;
  readonly definition: string;
  readonly enabled: string;
}

function referentialAction(value: string): string {
  const actions: Record<string, string> = {
    a: 'no action',
    r: 'restrict',
    c: 'cascade',
    n: 'set null',
    d: 'set default',
  };
  return actions[value] ?? value;
}

export async function liveCatalog(url: string): Promise<Catalog> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const columns = await sql<LiveColumnRow[]>`
      select
        table_name,
        column_name,
        case when data_type = 'USER-DEFINED' then udt_name else data_type end as column_type,
        is_nullable = 'NO' as not_null,
        column_default as default_expression,
        generation_expression as generated_expression
      from information_schema.columns
      where table_schema = 'public'
    `;
    const primaryKeys = await sql<LivePrimaryKeyRow[]>`
      select
        source.relname as table_name,
        array(
          select attribute.attname
          from unnest(constraint_row.conkey) with ordinality as key(attnum, position)
          join pg_attribute attribute
            on attribute.attrelid = constraint_row.conrelid and attribute.attnum = key.attnum
          order by key.position
        ) as columns
      from pg_constraint constraint_row
      join pg_class source on source.oid = constraint_row.conrelid
      join pg_namespace namespace on namespace.oid = source.relnamespace
      where namespace.nspname = 'public' and constraint_row.contype = 'p'
    `;
    const indexes = await sql<LiveIndexRow[]>`
      select
        source.relname as table_name,
        index_row.relname as index_name,
        definition.indisunique as unique_index,
        method.amname as method,
        array(
          select pg_get_indexdef(definition.indexrelid, position, true)
          from generate_series(1, definition.indnkeyatts) as position
          order by position
        ) as columns,
        pg_get_expr(definition.indpred, definition.indrelid, true) as predicate
      from pg_index definition
      join pg_class source on source.oid = definition.indrelid
      join pg_class index_row on index_row.oid = definition.indexrelid
      join pg_am method on method.oid = index_row.relam
      join pg_namespace namespace on namespace.oid = source.relnamespace
      where namespace.nspname = 'public' and not definition.indisprimary
    `;
    const foreignKeys = await sql<LiveForeignKeyRow[]>`
      select
        source.relname as table_name,
        constraint_row.conname as constraint_name,
        array(
          select attribute.attname
          from unnest(constraint_row.conkey) with ordinality as key(attnum, position)
          join pg_attribute attribute
            on attribute.attrelid = constraint_row.conrelid and attribute.attnum = key.attnum
          order by key.position
        ) as columns,
        target.relname as foreign_table,
        array(
          select attribute.attname
          from unnest(constraint_row.confkey) with ordinality as key(attnum, position)
          join pg_attribute attribute
            on attribute.attrelid = constraint_row.confrelid and attribute.attnum = key.attnum
          order by key.position
        ) as foreign_columns,
        constraint_row.confdeltype::text as on_delete,
        constraint_row.confupdtype::text as on_update
      from pg_constraint constraint_row
      join pg_class source on source.oid = constraint_row.conrelid
      join pg_class target on target.oid = constraint_row.confrelid
      join pg_namespace namespace on namespace.oid = source.relnamespace
      where namespace.nspname = 'public' and constraint_row.contype = 'f'
    `;
    const enums = await sql<LiveEnumRow[]>`
      select type_row.typname as enum_name,
        array_agg(enum_row.enumlabel order by enum_row.enumsortorder) as values
      from pg_type type_row
      join pg_enum enum_row on enum_row.enumtypid = type_row.oid
      join pg_namespace namespace on namespace.oid = type_row.typnamespace
      where namespace.nspname = 'public'
      group by type_row.typname
    `;
    const checks = await sql<LiveCheckRow[]>`
      select
        source.relname as table_name,
        constraint_row.conname as constraint_name,
        pg_get_constraintdef(constraint_row.oid) as definition
      from pg_constraint constraint_row
      join pg_class source on source.oid = constraint_row.conrelid
      join pg_namespace namespace on namespace.oid = source.relnamespace
      where namespace.nspname = 'public' and constraint_row.contype = 'c'
    `;
    const functions = await sql<LiveFunctionRow[]>`
      select
        routine_row.proname as function_name,
        pg_get_function_identity_arguments(routine_row.oid) as identity_arguments,
        pg_get_function_result(routine_row.oid) as return_type,
        language.lanname as language,
        pg_get_functiondef(routine_row.oid) as definition
      from pg_proc routine_row
      join pg_namespace namespace on namespace.oid = routine_row.pronamespace
      join pg_language language on language.oid = routine_row.prolang
      where namespace.nspname = 'public'
        and routine_row.prokind = 'f'
        and not exists (
          select 1
          from pg_depend dependency
            where dependency.classid = 'pg_proc'::regclass
            and dependency.objid = routine_row.oid
            and dependency.deptype = 'e'
        )
    `;
    const triggers = await sql<LiveTriggerRow[]>`
      select
        source.relname as table_name,
        trigger_row.tgname as trigger_name,
        pg_get_triggerdef(trigger_row.oid, true) as definition,
        trigger_row.tgenabled as enabled
      from pg_trigger trigger_row
      join pg_class source on source.oid = trigger_row.tgrelid
      join pg_namespace namespace on namespace.oid = source.relnamespace
      where namespace.nspname = 'public' and not trigger_row.tgisinternal
    `;

    const primaryByTable = new Map(primaryKeys.map((row) => [row.table_name, row.columns]));
    const indexesByTable = new Map<string, CatalogIndex[]>();
    for (const row of indexes) {
      const entries = indexesByTable.get(row.table_name) ?? [];
      entries.push({
        name: row.index_name,
        unique: row.unique_index,
        method: row.method,
        columns: row.columns.map(normalizeSql),
        predicate: row.predicate ?? '',
      });
      indexesByTable.set(row.table_name, entries);
    }
    const foreignKeysByTable = new Map<string, CatalogForeignKey[]>();
    for (const row of foreignKeys) {
      const entries = foreignKeysByTable.get(row.table_name) ?? [];
      entries.push({
        name: row.constraint_name,
        columns: row.columns,
        foreignTable: row.foreign_table,
        foreignColumns: row.foreign_columns,
        onDelete: referentialAction(row.on_delete),
        onUpdate: referentialAction(row.on_update),
      });
      foreignKeysByTable.set(row.table_name, entries);
    }
    const columnsByTable = new Map<string, CatalogColumn[]>();
    for (const row of columns) {
      const entries = columnsByTable.get(row.table_name) ?? [];
      entries.push({
        name: row.column_name,
        type: row.column_type,
        notNull: row.not_null,
        defaultExpression: normalizeCatalogExpression(row.default_expression ?? ''),
        generatedExpression: normalizeCatalogExpression(row.generated_expression ?? ''),
      });
      columnsByTable.set(row.table_name, entries);
    }
    const checksByTable = new Map<string, CatalogCheckConstraint[]>();
    for (const row of checks) {
      const entries = checksByTable.get(row.table_name) ?? [];
      entries.push({
        name: row.constraint_name,
        expression: row.definition.replace(/^CHECK\s*/iu, ''),
      });
      checksByTable.set(row.table_name, entries);
    }
    const catalogFunctions: CatalogFunction[] = functions.map((row) => ({
      name: row.function_name,
      identityArguments: row.identity_arguments,
      returnType: row.return_type,
      language: row.language,
      definition: normalizeFunctionDefinition(row.definition),
    }));
    const catalogTriggers: CatalogTrigger[] = triggers.map((row) => ({
      table: row.table_name,
      name: row.trigger_name,
      definition: normalizeTriggerDefinition(row.definition),
      enabled: row.enabled,
    }));

    return {
      tables: [...columnsByTable.entries()]
        .map(([name, entries]) => ({
          name,
          columns: entries.sort((left, right) => left.name.localeCompare(right.name)),
          primaryKey: primaryByTable.get(name) ?? [],
          indexes: (indexesByTable.get(name) ?? []).sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
          foreignKeys: (foreignKeysByTable.get(name) ?? []).sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
          checks: (checksByTable.get(name) ?? []).sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      enums: enums
        .map((row) => ({ name: row.enum_name, values: row.values }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      functions: catalogFunctions.sort((left, right) =>
        functionIdentity(left).localeCompare(functionIdentity(right)),
      ),
      triggers: catalogTriggers.sort((left, right) => {
        const tableOrder = left.table.localeCompare(right.table);
        return tableOrder === 0 ? left.name.localeCompare(right.name) : tableOrder;
      }),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function emptyDrift(): Drift {
  return {
    missingTables: [],
    missingColumns: [],
    columnMismatches: [],
    primaryKeyMismatches: [],
    missingIndexes: [],
    indexMismatches: [],
    missingForeignKeys: [],
    foreignKeyMismatches: [],
    missingChecks: [],
    checkMismatches: [],
    missingEnums: [],
    enumMismatches: [],
    missingFunctions: [],
    functionMismatches: [],
    missingTriggers: [],
    triggerMismatches: [],
    undeclaredTables: [],
    undeclaredIndexes: [],
    undeclaredForeignKeys: [],
    undeclaredChecks: [],
    undeclaredFunctions: [],
    undeclaredTriggers: [],
  };
}

function columnPropertyValue(property: ColumnMismatch['property'], column: CatalogColumn): string {
  if (property === 'type') return column.type;
  if (property === 'nullability') return column.notNull ? 'not null' : 'nullable';
  if (property === 'default') return column.defaultExpression;
  return column.generatedExpression;
}

const columnProperties: readonly ColumnMismatch['property'][] = [
  'type',
  'nullability',
  'default',
  'generated',
];

function compareColumns(expected: CatalogTable, live: CatalogTable, drift: Drift): void {
  const liveColumns = new Map(live.columns.map((column) => [column.name, column]));
  for (const column of expected.columns) {
    const actual = liveColumns.get(column.name);
    if (actual === undefined) {
      drift.missingColumns.push({ table: expected.name, column: column.name });
      continue;
    }
    for (const property of columnProperties) {
      const expectedValue = columnPropertyValue(property, column);
      const actualValue = columnPropertyValue(property, actual);
      if (expectedValue === actualValue) continue;
      drift.columnMismatches.push({
        table: expected.name,
        column: column.name,
        property,
        expected: expectedValue,
        actual: actualValue,
      });
    }
  }
}

function comparePrimaryKey(expected: CatalogTable, live: CatalogTable, drift: Drift): void {
  if (JSON.stringify(expected.primaryKey) === JSON.stringify(live.primaryKey)) return;
  drift.primaryKeyMismatches.push({
    table: expected.name,
    name: 'primary key',
    expected: expected.primaryKey.join(', '),
    actual: live.primaryKey.join(', '),
  });
}

function compareIndexes(expected: CatalogTable, live: CatalogTable, drift: Drift): void {
  const liveIndexes = new Map(live.indexes.map((index) => [index.name, index]));
  const unmatched = new Set(live.indexes);
  for (const index of expected.indexes) {
    const named = liveIndexes.get(index.name);
    const equivalent = live.indexes.find(
      (entry) => unmatched.has(entry) && stableIndex(entry) === stableIndex(index),
    );
    const actual = equivalent ?? (named !== undefined && unmatched.has(named) ? named : undefined);
    if (actual === undefined) {
      drift.missingIndexes.push({ table: expected.name, index: index.name });
    } else if (stableIndex(index) !== stableIndex(actual)) {
      drift.indexMismatches.push({
        table: expected.name,
        name: index.name,
        expected: stableIndex(index),
        actual: stableIndex(actual),
      });
    }
    if (actual !== undefined) unmatched.delete(actual);
  }
  for (const index of unmatched) {
    drift.undeclaredIndexes.push({ table: expected.name, index: index.name });
  }
}

function compareForeignKeys(expected: CatalogTable, live: CatalogTable, drift: Drift): void {
  const liveForeignKeys = new Map(live.foreignKeys.map((entry) => [entry.name, entry]));
  const unmatched = new Set(live.foreignKeys);
  for (const foreignKey of expected.foreignKeys) {
    const named = liveForeignKeys.get(foreignKey.name);
    const equivalent = live.foreignKeys.find(
      (entry) => unmatched.has(entry) && stableForeignKey(entry) === stableForeignKey(foreignKey),
    );
    const actual = equivalent ?? named;
    if (actual === undefined) {
      drift.missingForeignKeys.push({ table: expected.name, foreignKey: foreignKey.name });
    } else if (stableForeignKey(foreignKey) !== stableForeignKey(actual)) {
      drift.foreignKeyMismatches.push({
        table: expected.name,
        name: foreignKey.name,
        expected: stableForeignKey(foreignKey),
        actual: stableForeignKey(actual),
      });
    }
    if (actual !== undefined) unmatched.delete(actual);
  }
  for (const foreignKey of unmatched) {
    drift.undeclaredForeignKeys.push({
      table: expected.name,
      foreignKey: foreignKey.name,
    });
  }
}

function compareChecks(expected: CatalogTable, live: CatalogTable, drift: Drift): void {
  const liveChecks = new Map(live.checks.map((check) => [check.name, check]));
  const unmatched = new Set(live.checks);
  for (const check of expected.checks) {
    const named = liveChecks.get(check.name);
    const equivalent = live.checks.find(
      (entry) => unmatched.has(entry) && stableCheck(entry) === stableCheck(check),
    );
    const actual = equivalent ?? named;
    if (actual === undefined) {
      drift.missingChecks.push({ table: expected.name, check: check.name });
    } else if (stableCheck(actual) !== stableCheck(check)) {
      drift.checkMismatches.push({
        table: expected.name,
        name: check.name,
        expected: stableCheck(check),
        actual: stableCheck(actual),
      });
    }
    if (actual !== undefined) unmatched.delete(actual);
  }
  for (const check of unmatched) {
    drift.undeclaredChecks.push({ table: expected.name, check: check.name });
  }
}

function compareTable(expected: CatalogTable, live: CatalogTable, drift: Drift): void {
  compareColumns(expected, live, drift);
  comparePrimaryKey(expected, live, drift);
  compareIndexes(expected, live, drift);
  compareForeignKeys(expected, live, drift);
  compareChecks(expected, live, drift);
}

function compareEnums(expected: Catalog, live: Catalog, drift: Drift): void {
  const liveEnums = new Map(live.enums.map((entry) => [entry.name, entry]));
  for (const entry of expected.enums) {
    const actual = liveEnums.get(entry.name);
    if (actual === undefined) {
      drift.missingEnums.push(entry.name);
    } else if (JSON.stringify(entry.values) !== JSON.stringify(actual.values)) {
      drift.enumMismatches.push({
        name: entry.name,
        expected: entry.values.join(', '),
        actual: actual.values.join(', '),
      });
    }
  }
}

function compareFunctions(expected: Catalog, live: Catalog, drift: Drift): void {
  const expectedFunctions = expected.functions ?? [];
  const liveFunctions = live.functions ?? [];
  const liveByIdentity = new Map(liveFunctions.map((entry) => [functionIdentity(entry), entry]));
  for (const functionEntry of expectedFunctions) {
    const identity = functionIdentity(functionEntry);
    const actual = liveByIdentity.get(identity);
    if (actual === undefined) {
      drift.missingFunctions.push(identity);
      continue;
    }
    const expectedStable = stableFunction(functionEntry);
    const actualStable = stableFunction(actual);
    if (expectedStable !== actualStable) {
      drift.functionMismatches.push({
        name: identity,
        expected: expectedStable,
        actual: actualStable,
      });
    }
  }
  const expectedIdentities = new Set(expectedFunctions.map(functionIdentity));
  for (const functionEntry of liveFunctions) {
    const identity = functionIdentity(functionEntry);
    if (!expectedIdentities.has(identity)) drift.undeclaredFunctions.push(identity);
  }
}

function triggerIdentity(value: CatalogTrigger): string {
  return `${value.table}.${value.name}`;
}

function compareTriggers(expected: Catalog, live: Catalog, drift: Drift): void {
  const expectedTriggers = expected.triggers ?? [];
  const liveTriggers = live.triggers ?? [];
  const liveByIdentity = new Map(liveTriggers.map((entry) => [triggerIdentity(entry), entry]));
  for (const trigger of expectedTriggers) {
    const identity = triggerIdentity(trigger);
    const actual = liveByIdentity.get(identity);
    if (actual === undefined) {
      drift.missingTriggers.push({ table: trigger.table, trigger: trigger.name });
      continue;
    }
    const expectedStable = stableTrigger(trigger);
    const actualStable = stableTrigger(actual);
    if (expectedStable !== actualStable) {
      drift.triggerMismatches.push({
        table: trigger.table,
        name: trigger.name,
        expected: expectedStable,
        actual: actualStable,
      });
    }
  }
  const expectedIdentities = new Set(expectedTriggers.map(triggerIdentity));
  for (const trigger of liveTriggers) {
    const identity = triggerIdentity(trigger);
    if (!expectedIdentities.has(identity)) {
      drift.undeclaredTriggers.push({ table: trigger.table, trigger: trigger.name });
    }
  }
}

export function catalogDriftBetween(expected: Catalog, live: Catalog): Drift {
  const drift = emptyDrift();
  const liveTables = new Map(live.tables.map((table) => [table.name, table]));
  const expectedNames = new Set(expected.tables.map((table) => table.name));
  for (const table of expected.tables) {
    const actual = liveTables.get(table.name);
    if (actual === undefined) drift.missingTables.push(table.name);
    else compareTable(table, actual, drift);
  }
  drift.undeclaredTables.push(
    ...live.tables.filter((table) => !expectedNames.has(table.name)).map((table) => table.name),
  );
  for (const table of live.tables.filter((entry) => !expectedNames.has(entry.name))) {
    drift.undeclaredIndexes.push(
      ...table.indexes.map((index) => ({ table: table.name, index: index.name })),
    );
    drift.undeclaredForeignKeys.push(
      ...table.foreignKeys.map((foreignKey) => ({
        table: table.name,
        foreignKey: foreignKey.name,
      })),
    );
    drift.undeclaredChecks.push(
      ...table.checks.map((check) => ({ table: table.name, check: check.name })),
    );
  }
  compareEnums(expected, live, drift);
  compareFunctions(expected, live, drift);
  compareTriggers(expected, live, drift);

  return drift;
}

export function isBehind(drift: Drift): boolean {
  return (
    drift.missingTables.length > 0 ||
    drift.missingColumns.length > 0 ||
    drift.columnMismatches.length > 0 ||
    drift.primaryKeyMismatches.length > 0 ||
    drift.missingIndexes.length > 0 ||
    drift.indexMismatches.length > 0 ||
    drift.missingForeignKeys.length > 0 ||
    drift.foreignKeyMismatches.length > 0 ||
    drift.missingChecks.length > 0 ||
    drift.checkMismatches.length > 0 ||
    drift.missingEnums.length > 0 ||
    drift.enumMismatches.length > 0 ||
    drift.missingFunctions.length > 0 ||
    drift.functionMismatches.length > 0 ||
    drift.missingTriggers.length > 0 ||
    drift.triggerMismatches.length > 0
  );
}

function requiredDriftLines(drift: Drift): string[] {
  return [
    ...drift.missingTables.map((table) => `  missing table       ${table}`),
    ...drift.missingColumns.map((entry) => `  missing column      ${entry.table}.${entry.column}`),
    ...drift.columnMismatches.map(
      (entry) =>
        `  column mismatch     ${entry.table}.${entry.column} ${entry.property}: ${entry.actual}, expected ${entry.expected}`,
    ),
    ...drift.primaryKeyMismatches.map(
      (entry) =>
        `  primary mismatch    ${entry.table}: ${entry.actual}, expected ${entry.expected}`,
    ),
    ...drift.missingIndexes.map((entry) => `  missing index       ${entry.table}.${entry.index}`),
    ...drift.indexMismatches.map((entry) => `  index mismatch      ${entry.table}.${entry.name}`),
    ...drift.missingForeignKeys.map(
      (entry) => `  missing foreign key ${entry.table}.${entry.foreignKey}`,
    ),
    ...drift.foreignKeyMismatches.map(
      (entry) => `  foreign key mismatch ${entry.table}.${entry.name}`,
    ),
    ...drift.missingChecks.map((entry) => `  missing check       ${entry.table}.${entry.check}`),
    ...drift.checkMismatches.map((entry) => `  check mismatch      ${entry.table}.${entry.name}`),
    ...drift.missingEnums.map((entry) => `  missing enum        ${entry}`),
    ...drift.enumMismatches.map((entry) => `  enum mismatch       ${entry.name}`),
    ...drift.missingFunctions.map((entry) => `  missing function    ${entry}`),
    ...drift.functionMismatches.map((entry) => `  function mismatch   ${entry.name}`),
    ...drift.missingTriggers.map(
      (entry) => `  missing trigger     ${entry.table}.${entry.trigger}`,
    ),
    ...drift.triggerMismatches.map((entry) => `  trigger mismatch    ${entry.table}.${entry.name}`),
  ];
}

export function describeDrift(drift: Drift, target: string): string {
  const behind = isBehind(drift);
  const lines = behind
    ? [
        `${target} is not compatible with packages/db/src/schema:`,
        ...requiredDriftLines(drift),
        '',
        'Run bun run db:release before deploying this code.',
      ]
    : [`${target} has every schema object and invariant this code requires.`];
  if (drift.undeclaredTables.length > 0) {
    lines.push(
      '',
      'Undeclared tables are preserved and reported, never removed by this check:',
      ...drift.undeclaredTables.map((table) => `  ${table}`),
    );
  }
  if (
    drift.undeclaredIndexes.length > 0 ||
    drift.undeclaredForeignKeys.length > 0 ||
    drift.undeclaredChecks.length > 0 ||
    drift.undeclaredFunctions.length > 0 ||
    drift.undeclaredTriggers.length > 0
  ) {
    lines.push(
      '',
      'Additional indexes, foreign keys, checks, functions, and triggers are preserved and reported:',
      ...drift.undeclaredIndexes.map((entry) => `  index ${entry.table}.${entry.index}`),
      ...drift.undeclaredForeignKeys.map(
        (entry) => `  foreign key ${entry.table}.${entry.foreignKey}`,
      ),
      ...drift.undeclaredChecks.map((entry) => `  check ${entry.table}.${entry.check}`),
      ...drift.undeclaredFunctions.map((entry) => `  function ${entry}`),
      ...drift.undeclaredTriggers.map((entry) => `  trigger ${entry.table}.${entry.trigger}`),
    );
  }

  lines.push('');
  return lines.join('\n');
}

function targetName(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'The configured database';
  }
}

const GUARD_FLAG = '--guard-deploy';

if (import.meta.main) {
  const guarding = process.argv.includes(GUARD_FLAG);
  const productionGuard =
    guarding &&
    (process.env['VERCEL_ENV'] === 'production' ||
      process.env['ORBIT_REQUIRE_SCHEMA_GUARD'] === '1');
  const url = process.env['DATABASE_URL'];

  if (url === undefined || url.length === 0) {
    if (!guarding) {
      process.stderr.write('DATABASE_URL is not set.\n');
      process.exit(2);
    }
    if (productionGuard) {
      process.stderr.write(
        'Production schema verification is required, but DATABASE_URL is not set.\n',
      );
      process.exit(1);
    }
    process.stdout.write('No DATABASE_URL, so there is no database to check against.\n');
    process.exit(0);
  }

  let live: Catalog;
  try {
    live = await liveCatalog(url);
  } catch (error) {
    if (!guarding) throw error;
    if (productionGuard) {
      process.stderr.write(
        `Production schema verification is required, but ${targetName(url)} could not be reached: ${String(error)}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `Could not reach ${targetName(url)}, so its schema went unchecked: ${String(error)}\n`,
    );
    process.exit(0);
  }

  const drift = catalogDriftBetween(expectedCatalog(schema), live);
  process.stdout.write(describeDrift(drift, targetName(url)));
  if (!isBehind(drift)) process.exit(0);
  if (guarding) {
    process.stdout.write('\nRefusing to build against an incompatible database.\n');
  }
  process.exit(1);
}
