import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';

const BASE = (process.env['ORBIT_SHOTS_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const USER = process.env['ORBIT_SHOTS_USER'] ?? 'alex@orbit.example';
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const OUT = resolve(REPO_ROOT, 'docs/assets/screenshots');
const RELATIVE_OUT = 'docs/assets/screenshots';
const SHOT_FILTER = new Set(
  (process.env['ORBIT_SHOTS_FILTER'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
);
const WIDTH = 1680;
const HEIGHT = 1000;
const THEMES = ['light', 'dark'] as const;

type Theme = (typeof THEMES)[number];

interface Shot {
  readonly name: string;
  readonly path: string;
  readonly caption: string;
  readonly settleMs?: number;
  readonly act?: (page: Page) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson(page: Page, path: string): Promise<unknown> {
  return await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return (await response.json()) as unknown;
  }, `${BASE}${path}`);
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(
    async ({ url, email }) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return response.status;
    },
    { url: `${BASE}/api/dev/sign-in`, email: USER },
  );
  if (result !== 200) {
    throw new Error(
      `Dev sign-in answered ${result}. Is ORBIT_DEV_LOGIN=1 set and the database seeded?`,
    );
  }
}

async function firstDocId(page: Page): Promise<string | null> {
  const body = await readJson(page, '/api/docs');
  if (!(isRecord(body) && Array.isArray(body['docs']))) return null;
  const first = body['docs'][0];
  if (!isRecord(first) || typeof first['id'] !== 'string') return null;
  return first['id'];
}

async function firstProjectSlug(page: Page): Promise<string | null> {
  const body = await readJson(page, '/api/projects');
  if (!(isRecord(body) && Array.isArray(body['projects']))) return null;
  const first = body['projects'][0];
  if (!isRecord(first) || typeof first['slug'] !== 'string') return null;
  return first['slug'];
}

async function firstPersonWithWork(page: Page): Promise<string | null> {
  const body = await readJson(page, '/api/analytics/people?lens=people');
  if (!(isRecord(body) && Array.isArray(body['people']))) return null;
  for (const entry of body['people']) {
    if (!(isRecord(entry) && isRecord(entry['person']))) continue;
    const assignments = entry['currentAssignments'];
    const completions = entry['completedIssues'];
    const id = entry['person']['id'];
    if (
      typeof id === 'string' &&
      ((typeof assignments === 'number' && assignments > 0) ||
        (typeof completions === 'number' && completions > 0))
    ) {
      return id;
    }
  }
  return null;
}

async function firstIssueIdentifier(page: Page, teamKey: string): Promise<string | null> {
  const body = await readJson(page, `/api/issues?teamKey=${teamKey}&limit=20`);
  if (!(isRecord(body) && Array.isArray(body['issues']))) return null;
  for (const entry of body['issues']) {
    if (!isRecord(entry) || typeof entry['identifier'] !== 'string') continue;
    if (entry['identifier'].startsWith(`${teamKey}-`)) return entry['identifier'];
  }
  return null;
}

async function buildShots(page: Page): Promise<Shot[]> {
  const personId = await firstPersonWithWork(page);
  const shots: Shot[] = [
    { name: 'board', path: '/team/ENG/board', caption: 'Board' },
    { name: 'issues', path: '/team/ENG/issues', caption: 'Issue list' },
    { name: 'sprints', path: '/sprints', caption: 'Sprints' },
    { name: 'standup', path: '/standup', caption: 'Standup' },
    { name: 'analytics', path: '/analytics', caption: 'Analytics', settleMs: 1800 },
    {
      name: 'analytics-sprints',
      path: '/analytics?lens=sprints',
      caption: 'Analytics sprint planning',
      settleMs: 1800,
    },
    {
      name: 'analytics-people',
      path:
        personId === null
          ? '/analytics?lens=people'
          : `/analytics?lens=people&personId=${personId}`,
      caption: 'Analytics personal planning',
      settleMs: 1800,
    },
    {
      name: 'analytics-hover',
      path: '/analytics?lens=sprints',
      caption: 'Analytics exact chart value',
      settleMs: 1800,
      act: async (target) => {
        const point = target.locator('[data-testid^="plot-hit-"]').last();
        await point.hover({ force: true });
        await target.getByRole('tooltip').waitFor();
      },
    },
    {
      name: 'analytics-filters',
      path: '/analytics',
      caption: 'Analytics advanced filters',
      settleMs: 1800,
      act: async (target) => {
        await target.getByRole('button', { name: 'Add filter' }).click();
        await target.getByTestId('filter-field-project').click();
        await target.locator('[data-testid^="filter-value-"]').first().click();
        await target.keyboard.press('Escape');
        await target.getByRole('button', { name: 'Scope' }).click();
      },
    },
    { name: 'projects', path: '/projects', caption: 'Projects' },
    { name: 'inbox', path: '/inbox', caption: 'Inbox' },
    { name: 'my-issues', path: '/my-issues', caption: 'My issues' },
    { name: 'docs-list', path: '/docs', caption: 'Docs' },
    {
      name: 'command-palette',
      path: '/team/ENG/issues',
      caption: 'Command palette',
      settleMs: 900,
      act: async (target) => {
        await target.keyboard.press('ControlOrMeta+k');
        await target.waitForTimeout(700);
      },
    },
  ];

  const issue = await firstIssueIdentifier(page, 'ENG');
  if (issue !== null) {
    shots.splice(2, 0, { name: 'issue', path: `/issue/${issue}`, caption: 'Issue detail' });
  }

  const docId = await firstDocId(page);
  if (docId !== null) {
    shots.push({ name: 'doc', path: `/docs/${docId}`, caption: 'Document', settleMs: 1500 });
  }

  const projectSlug = await firstProjectSlug(page);
  if (projectSlug !== null) {
    shots.push({
      name: 'project',
      path: `/projects/${projectSlug}`,
      caption: 'Project overview',
      settleMs: 1500,
    });
  }

  return shots;
}

async function openContext(browser: Browser, theme: Theme) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(`window.localStorage.setItem('theme', '${theme}');`);
  return context;
}

async function settle(page: Page, ms: number): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
  });
}

async function capture(browser: Browser, theme: Theme, shots: readonly Shot[]): Promise<string[]> {
  const context = await openContext(browser, theme);
  const page = await context.newPage();
  await signIn(page);
  const written: string[] = [];

  for (const shot of shots) {
    const file = `${OUT}/${shot.name}-${theme}.png`;
    const label = `${RELATIVE_OUT}/${shot.name}-${theme}.png`;
    try {
      await page.goto(`${BASE}${shot.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await settle(page, shot.settleMs ?? 1200);
      if (shot.act !== undefined) await shot.act(page);
      await page.screenshot({ path: file, animations: 'disabled' });
      written.push(file);
      console.log(`  ${label}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.log(`  SKIPPED ${label}: ${detail}`);
    }
  }

  await context.close();
  return written;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (health === null || !health.ok) {
    throw new Error(`No Orbit at ${BASE}. Run bun run dev first, or set ORBIT_SHOTS_URL.`);
  }

  const browser = await chromium.launch();
  const setupContext = await openContext(browser, 'light');
  const setupPage = await setupContext.newPage();
  await signIn(setupPage);
  const allShots = await buildShots(setupPage);
  const shots =
    SHOT_FILTER.size === 0 ? allShots : allShots.filter((shot) => SHOT_FILTER.has(shot.name));
  await setupContext.close();

  console.log(`Capturing ${shots.length} screens in ${THEMES.length} themes from ${BASE}`);
  let total = 0;
  for (const theme of THEMES) {
    console.log(`\n${theme}:`);
    total += (await capture(browser, theme, shots)).length;
  }
  await browser.close();
  console.log(`\nWrote ${total} images to ${RELATIVE_OUT}`);
}

if (import.meta.main) await main();
