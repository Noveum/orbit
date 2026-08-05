import type { Page } from '@playwright/test';
import { z } from 'zod';

const bootstrapTeamsSchema = z.object({
  teams: z.array(z.object({ id: z.string().min(1), key: z.string().min(1) })).default([]),
});

const bootstrapStatesSchema = z.object({
  states: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), teamId: z.string().min(1) }))
    .default([]),
});

const issueEnvelopeSchema = z.object({
  issue: z.object({ id: z.string().min(1), identifier: z.string().min(1) }),
});

const cycleEnvelopeSchema = z.object({
  cycle: z.object({ id: z.string().min(1), number: z.number().int().positive() }),
});

const docEnvelopeSchema = z.object({ doc: z.object({ id: z.string().min(1) }) });

async function json(page: Page, path: string, init?: RequestInit): Promise<unknown> {
  return await page.evaluate(
    async ({ url, options }) => {
      const response = await fetch(url, options as RequestInit);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return (await response.json()) as unknown;
    },
    { url: path, options: init ?? {} },
  );
}

export async function teamIdByKey(page: Page, key: string): Promise<string> {
  const body = bootstrapTeamsSchema.parse(await json(page, '/api/bootstrap'));
  const team = body.teams.find((entry) => entry.key === key);
  if (team === undefined) throw new Error(`no team keyed ${key} in this workspace`);
  return team.id;
}

export async function createIssue(
  page: Page,
  teamId: string,
  title: string,
): Promise<{ id: string; identifier: string }> {
  const body = await json(page, '/api/issues', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamId, title }),
  });
  return issueEnvelopeSchema.parse(body).issue;
}

export async function createSprint(
  page: Page,
  teamId: string,
  name: string,
): Promise<{ id: string; number: number }> {
  const body = await json(page, '/api/cycles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId,
      name,
      startsAt: '2033-04-03T00:00:00.000Z',
      endsAt: '2033-04-17T00:00:00.000Z',
    }),
  });
  return cycleEnvelopeSchema.parse(body).cycle;
}

export async function completeSprint(page: Page, cycleId: string): Promise<void> {
  await json(page, `/api/cycles/${cycleId}/complete`, { method: 'POST' });
}

export async function createDoc(
  page: Page,
  title: string,
  visibility: string,
): Promise<{ id: string }> {
  const body = await json(page, '/api/docs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, content: 'Body.', visibility }),
  });
  return docEnvelopeSchema.parse(body).doc;
}

export async function statusOf(page: Page, path: string): Promise<number> {
  return await page.evaluate(async (url) => (await fetch(url)).status, path);
}

export async function stateIdOf(page: Page, identifier: string): Promise<string> {
  const body = await json(page, `/api/issues/${identifier}`);
  return z.object({ issue: z.object({ stateId: z.string().min(1) }) }).parse(body).issue.stateId;
}

export async function stateIdByName(page: Page, teamId: string, name: string): Promise<string> {
  const body = bootstrapStatesSchema.parse(await json(page, '/api/bootstrap'));
  const state = body.states.find((entry) => entry.teamId === teamId && entry.name === name);
  if (state === undefined) throw new Error(`no state named ${name} on that team`);
  return state.id;
}
