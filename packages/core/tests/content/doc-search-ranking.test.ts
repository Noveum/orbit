import { beforeEach, describe, expect, it } from 'bun:test';
import { HIGHLIGHT_END, HIGHLIGHT_START, highlightSegments } from '@orbit/shared/utils';
import { createDoc, listDocs, usesLexemes } from '../../src/content/doc-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newDoc(title: string, content: string) {
  const { doc } = await createDoc(workspace.admin, { title, content });
  return doc;
}

describe('doc search', () => {
  it('puts a title match above a body match', async () => {
    const body = await newDoc('Runbook', 'The deployment pipeline runs on every merge.');
    const title = await newDoc('Deployment guide', 'Nothing to see.');

    const rows = await listDocs(workspace.admin, { query: 'deployment' });
    const ids = rows.map((row) => row.id);

    expect(ids.indexOf(title.id)).toBeLessThan(ids.indexOf(body.id));
  });

  it('ranks the doc that mentions the term more often above the one that mentions it once', async () => {
    const sparse = await newDoc('Sparse', 'One mention of postgres here.');
    const dense = await newDoc(
      'Dense',
      'Postgres tuning for postgres replicas, because postgres replication lag on postgres matters.',
    );

    const rows = await listDocs(workspace.admin, { query: 'postgres' });
    const ids = rows.map((row) => row.id);

    expect(ids.indexOf(dense.id)).toBeLessThan(ids.indexOf(sparse.id));
  });

  it('matches a stemmed word rather than only the exact spelling', async () => {
    const doc = await newDoc('Retries', 'The worker retries a failed job three times.');

    const rows = await listDocs(workspace.admin, { query: 'retry' });

    expect(rows.map((row) => row.id)).toContain(doc.id);
  });

  it('marks the match inside the snippet it returns', async () => {
    await newDoc('Runbook', 'Page the on call engineer when the ingest queue backs up.');

    const [row] = await listDocs(workspace.admin, { query: 'ingest' });
    const matched = highlightSegments(row?.snippet ?? '')
      .filter((segment) => segment.match)
      .map((segment) => segment.text.toLowerCase());

    expect(row?.snippet).toContain(HIGHLIGHT_START);
    expect(row?.snippet).toContain(HIGHLIGHT_END);
    expect(matched).toContain('ingest');
  });

  it('still answers a two letter query through the title', async () => {
    const doc = await newDoc('QA checklist', 'Nothing relevant in the body.');

    expect(usesLexemes('qa')).toBe(false);
    const rows = await listDocs(workspace.admin, { query: 'qa' });

    expect(rows.map((row) => row.id)).toContain(doc.id);
  });

  it('finds a partial word in a title that full text alone would miss', async () => {
    const doc = await newDoc('Billing reconciliation', 'Nothing relevant in the body.');

    const rows = await listDocs(workspace.admin, { query: 'billin' });

    expect(rows.map((row) => row.id)).toContain(doc.id);
  });

  it('leaves the snippet empty when only the title matched', async () => {
    await newDoc('Billing reconciliation', 'Nothing relevant in the body.');

    const [row] = await listDocs(workspace.admin, { query: 'billing' });

    expect(row?.titleMatch).toBe(true);
    expect(row?.snippet).toBe('');
  });

  it('keeps the manual order when nothing was searched for', async () => {
    const first = await newDoc('First', 'Alpha.');
    const second = await newDoc('Second', 'Beta.');

    const rows = await listDocs(workspace.admin, {});

    expect(rows.map((row) => row.id).indexOf(first.id)).toBeLessThan(
      rows.map((row) => row.id).indexOf(second.id),
    );
  });
});
