import { describe, expect, it } from 'bun:test';
import { emptyFilterGroup } from '@orbit/shared/filters';
import { QueryClient } from '@tanstack/react-query';
import { groupColumnSearch, type IssueQuery } from '@/lib/query/issue-search.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { BoardPage, Issue } from '@/lib/query/schemas.ts';
import type { IssuePages } from '@/lib/query/sync.ts';
import { type BoardColumnKey, columnScopeKey, seedBoardColumns } from '@/lib/query/use-issues.ts';

const query: IssueQuery = { filter: emptyFilterGroup(), orderBy: 'manual' };

const column: BoardColumnKey = { query, groupBy: 'state', scope: { teamId: 'team-1' } };

function issue(id: string): Issue {
  return { id, identifier: id, teamId: 'team-1', stateId: 'todo' } as unknown as Issue;
}

function boardPage(ids: readonly string[]): BoardPage {
  return {
    groups: [{ id: 'todo', total: ids.length, issues: ids.map(issue), nextCursor: null }],
  } as unknown as BoardPage;
}

function columnKey() {
  const search = groupColumnSearch(column.query, column.groupBy, 'todo', column.scope);
  return queryKeys.issues(columnScopeKey(column.scope), search);
}

function identifiersIn(client: QueryClient): string[] {
  const held = client.getQueryData<IssuePages>(columnKey());
  return (held?.pages ?? []).flatMap((page) => page.issues.map((row) => row.identifier));
}

describe('seedBoardColumns', () => {
  it('seeds a column that has nothing in it', () => {
    const client = new QueryClient();
    seedBoardColumns(client, column, boardPage(['ENG-1']), Date.now());
    expect(identifiersIn(client)).toEqual(['ENG-1']);
  });

  it('replaces data that was written before the board page was fetched', () => {
    const client = new QueryClient();
    client.setQueryData<IssuePages>(columnKey(), {
      pages: [{ issues: [issue('ENG-1')], nextCursor: null }],
      pageParams: [null],
    });

    const fetchedAt = Date.now() + 1_000;
    seedBoardColumns(client, column, boardPage(['ENG-1', 'ENG-19']), fetchedAt);

    expect(identifiersIn(client)).toEqual(['ENG-1', 'ENG-19']);
  });

  it('keeps data written while the board page was in flight', () => {
    const client = new QueryClient();
    const fetchedAt = Date.now() - 1_000;
    client.setQueryData<IssuePages>(columnKey(), {
      pages: [{ issues: [issue('ENG-7')], nextCursor: null }],
      pageParams: [null],
    });

    seedBoardColumns(client, column, boardPage(['ENG-1']), fetchedAt);

    expect(identifiersIn(client)).toEqual(['ENG-7']);
  });
});
