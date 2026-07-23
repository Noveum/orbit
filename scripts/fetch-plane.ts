import { resolve } from 'node:path';

interface Page<T> {
  results: T[];
  next_page_results: boolean;
  next_cursor: string;
}

interface PlaneProject {
  id: string;
  identifier: string;
  name: string;
  description?: string;
}

interface PlaneState {
  id: string;
  name: string;
  group: string;
}

interface PlaneLabel {
  id: string;
  name: string;
}

interface PlaneMember {
  id: string;
  display_name: string;
}

interface PlaneGrouping {
  id: string;
  name: string;
}

interface PlaneGroupingIssue {
  id: string;
  issue?: string;
}

interface PlaneIssue {
  id: string;
  sequence_id: number;
  name: string;
  priority: string;
  state: string;
  assignees?: string[];
  labels?: string[];
  target_date?: string | null;
  description_html?: string;
}

interface PlaneComment {
  actor: string;
  created_at: string;
  comment_html?: string;
}

interface PlanePage {
  id: string;
  name?: string;
  description_html?: string;
}

interface PlaneAsset {
  asset_url?: string;
}

interface AssetRecord {
  fileName: string;
  contentType: string;
  size: number;
}

const KEY = process.env['PLANE_API_KEY'] ?? '';
const SLUG = process.env['PLANE_WORKSPACE'] ?? 'noveum-ai';
const OUT = resolve(process.env['PLANE_OUT'] ?? 'extras/import/plane');
const RATE = Number(process.env['PLANE_RATE'] ?? 55);
const WITH_LINKS = process.env['PLANE_LINKS'] === '1';

if (KEY.length === 0) throw new Error('PLANE_API_KEY is not set.');
if (!Number.isFinite(RATE) || RATE < 1) {
  throw new Error(`PLANE_RATE must be a number of at least 1, got "${process.env['PLANE_RATE']}".`);
}

const BASE = `https://api.plane.so/api/v1/workspaces/${SLUG}`;

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

const requestWindow: number[] = [];
let requests = 0;
let throttled = 0;

async function takeSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    for (;;) {
      const oldest = requestWindow[0];
      if (oldest === undefined || now - oldest <= 60_000) break;
      requestWindow.shift();
    }
    if (requestWindow.length < RATE) {
      requestWindow.push(now);
      return;
    }
    const oldest = requestWindow[0] ?? now;
    await sleep(Math.max(250, 60_000 - (now - oldest)));
  }
}

async function get<T>(path: string, attempt = 0): Promise<T> {
  await takeSlot();
  requests += 1;
  const response = await fetch(BASE + path, { headers: { 'x-api-key': KEY } });
  if (response.status === 429 || response.status >= 500) {
    throttled += 1;
    if (attempt >= 8) throw new Error(`${response.status} on ${path}`);
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    await sleep(retryAfter > 0 ? (retryAfter + 1) * 1000 : 2000 * 2 ** attempt);
    return get<T>(path, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} on ${path}`);
  return (await response.json()) as T;
}

async function collect<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const suffix: string =
      cursor === null ? '' : `${separator}cursor=${encodeURIComponent(cursor)}`;
    const page: T[] | Page<T> = await get<T[] | Page<T>>(`${path}${suffix}`);
    if (Array.isArray(page)) return page;
    rows.push(...page.results);
    if (!page.next_page_results || seen.has(page.next_cursor)) return rows;
    seen.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}

async function mapConcurrent<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) return;
        await worker(item);
      }
    }),
  );
}

async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  await Bun.write(resolve(directory, `${name}.json`), JSON.stringify(value, null, 2));
}

async function writeText(directory: string, name: string, value: string): Promise<void> {
  await Bun.write(resolve(directory, name), value);
}

function htmlToMarkdown(html: string | null | undefined): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  return html
    .replace(
      /<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_m: string, href: string, text: string) =>
        text.trim().length === 0 ? href : `[${text.trim()}](${href})`,
    )
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<(strong|b)>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)>/gi, '_')
    .replace(/<\/(em|i)>/gi, '_')
    .replace(/<code[^>]*>/gi, '`')
    .replace(/<\/code>/gi, '`')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

const IMAGE_TAG = /<image-component[^>]*\bsrc="([0-9a-fA-F-]{36})"/g;
const assetManifest: Record<string, AssetRecord> = {};

function assetIdsIn(html: string | null | undefined): string[] {
  if (typeof html !== 'string') return [];
  const ids: string[] = [];
  for (const match of html.matchAll(IMAGE_TAG)) {
    const id = match[1];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

async function downloadAsset(assetId: string): Promise<void> {
  if (assetManifest[assetId] !== undefined) return;
  const meta = await get<PlaneAsset>(`/assets/${assetId}/`).catch(() => null);
  const url = meta?.asset_url;
  if (typeof url !== 'string' || url.length === 0) return;

  const response = await fetch(url);
  if (!response.ok) return;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const named = /filename[^=]*=(?:UTF-8'')?"?([^&";]+)/i.exec(decodeURIComponent(url));
  const raw = named?.[1] ?? '';
  const fileName = slugify(raw.length > 0 ? raw : 'image').concat(
    raw.includes('.') ? `.${raw.split('.').pop() ?? 'png'}` : '.png',
  );
  await Bun.write(resolve(OUT, 'assets', assetId), bytes);
  assetManifest[assetId] = {
    fileName,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    size: bytes.byteLength,
  };
  log(`  asset ${assetId} ${fileName} ${bytes.byteLength} bytes`);
}

const projects = await collect<PlaneProject>('/projects/?per_page=100');
await writeJson(OUT, 'projects', projects);
log(`projects: ${projects.length}`);

const members = await get<PlaneMember[]>('/members/');
await writeJson(OUT, 'members', members);
log(`members: ${members.length}`);

const workspacePages = await collect<PlanePage>('/pages/?per_page=100').catch(() => []);
await writeJson(OUT, 'workspace-pages', workspacePages);
log(`workspace pages: ${workspacePages.length}`);

const summaryRows: string[] = [];
const inaccessible: string[] = [];

for (const project of projects) {
  const id = project.id;
  const directory = resolve(OUT, project.identifier);

  if (
    (await Bun.file(resolve(directory, 'issues.json')).exists()) &&
    process.env['PLANE_FORCE'] !== '1'
  ) {
    log(`${project.identifier}: cached, skipping`);
    continue;
  }

  log(`${project.identifier}: fetching metadata`);
  const states = await collect<PlaneState>(`/projects/${id}/states/?per_page=100`).catch(
    (error: unknown) => {
      if (String(error).includes('403')) return null;
      throw error;
    },
  );
  if (states === null) {
    log(`${project.identifier}: no permission to read this project, skipping`);
    inaccessible.push(project.identifier);
    continue;
  }
  const labels = await collect<PlaneLabel>(`/projects/${id}/labels/?per_page=100`);
  const cycles = await collect<PlaneGrouping>(`/projects/${id}/cycles/?per_page=100`);
  const modules = await collect<PlaneGrouping>(`/projects/${id}/modules/?per_page=100`);
  const projectMembers = await get<PlaneMember[]>(`/projects/${id}/members/`).catch(() => []);
  const issueTypes = await get<unknown[]>(`/projects/${id}/issue-types/`).catch(() => []);
  const pages = await collect<PlanePage>(`/projects/${id}/pages/?per_page=100`).catch(() => []);

  const issues = await collect<PlaneIssue>(`/projects/${id}/issues/?per_page=100`);
  log(`${project.identifier}: ${issues.length} issues, fetching comments`);

  const cycleIssues: Record<string, string[]> = {};
  for (const item of cycles) {
    const rows = await collect<PlaneGroupingIssue>(
      `/projects/${id}/cycles/${item.id}/cycle-issues/?per_page=100`,
    ).catch(() => []);
    cycleIssues[item.id] = rows.map((row) => row.issue ?? row.id);
  }

  const moduleIssues: Record<string, string[]> = {};
  for (const item of modules) {
    const rows = await collect<PlaneGroupingIssue>(
      `/projects/${id}/modules/${item.id}/module-issues/?per_page=100`,
    ).catch(() => []);
    moduleIssues[item.id] = rows.map((row) => row.issue ?? row.id);
  }

  const comments: Record<string, PlaneComment[]> = {};
  let done = 0;
  await mapConcurrent(issues, 4, async (item) => {
    const rows = await collect<PlaneComment>(
      `/projects/${id}/issues/${item.id}/comments/?per_page=100`,
    ).catch(() => []);
    if (rows.length > 0) comments[item.id] = rows;
    done += 1;
    if (done % 50 === 0) log(`  ${project.identifier}: ${done}/${issues.length} comment threads`);
  });

  const links: Record<string, unknown[]> = {};
  if (WITH_LINKS) {
    await mapConcurrent(issues, 4, async (item) => {
      const rows = await collect<unknown>(
        `/projects/${id}/issues/${item.id}/links/?per_page=100`,
      ).catch(() => []);
      if (rows.length > 0) links[item.id] = rows;
    });
  }

  const pageDetails: PlanePage[] = [];
  await mapConcurrent(pages, 2, async (page) => {
    const detail = await get<PlanePage>(`/projects/${id}/pages/${page.id}/`).catch(() => page);
    pageDetails.push(detail);
  });

  const referenced = new Set<string>();
  for (const item of issues)
    for (const asset of assetIdsIn(item.description_html)) referenced.add(asset);
  for (const rows of Object.values(comments))
    for (const row of rows) for (const asset of assetIdsIn(row.comment_html)) referenced.add(asset);
  for (const page of pageDetails)
    for (const asset of assetIdsIn(page.description_html)) referenced.add(asset);
  for (const assetId of referenced) await downloadAsset(assetId);

  await writeJson(directory, 'project', project);
  await writeJson(directory, 'states', states);
  await writeJson(directory, 'labels', labels);
  await writeJson(directory, 'cycles', cycles);
  await writeJson(directory, 'modules', modules);
  await writeJson(directory, 'members', projectMembers);
  await writeJson(directory, 'issue-types', issueTypes);
  await writeJson(directory, 'cycle-issues', cycleIssues);
  await writeJson(directory, 'module-issues', moduleIssues);
  await writeJson(directory, 'comments', comments);
  await writeJson(directory, 'links', links);
  await writeJson(directory, 'pages', pageDetails);
  await writeJson(directory, 'issues', issues);

  const stateById = new Map(states.map((row): [string, PlaneState] => [row.id, row]));
  const memberById = new Map(projectMembers.map((row): [string, PlaneMember] => [row.id, row]));
  const labelById = new Map(labels.map((row): [string, PlaneLabel] => [row.id, row]));

  const readable = [`# ${project.name} (${project.identifier})`, ''];
  if (project.description) readable.push(project.description, '');
  readable.push(`${issues.length} work items`, '');
  for (const item of [...issues].sort((a, b) => a.sequence_id - b.sequence_id)) {
    const state = stateById.get(item.state);
    const assignees = (item.assignees ?? [])
      .map((row) => memberById.get(row)?.display_name ?? row)
      .join(', ');
    const itemLabels = (item.labels ?? []).map((row) => labelById.get(row)?.name ?? row).join(', ');
    readable.push(`## ${project.identifier}-${item.sequence_id}  ${item.name}`, '');
    readable.push(
      `state: ${state?.name ?? 'unknown'} (${state?.group ?? '?'}) · priority: ${item.priority}` +
        (assignees ? ` · assignee: ${assignees}` : '') +
        (itemLabels ? ` · labels: ${itemLabels}` : '') +
        (item.target_date ? ` · due: ${item.target_date}` : ''),
    );
    const body = htmlToMarkdown(item.description_html);
    if (body) readable.push('', body);
    for (const entry of comments[item.id] ?? []) {
      const author = memberById.get(entry.actor)?.display_name ?? 'someone';
      readable.push(
        '',
        `> **${author}** ${entry.created_at}`,
        `> ${htmlToMarkdown(entry.comment_html).replace(/\n/g, '\n> ')}`,
      );
    }
    readable.push('');
  }
  await writeText(directory, 'issues.md', readable.join('\n'));

  for (const page of pageDetails) {
    await writeText(
      resolve(directory, 'pages'),
      `${slugify(page.name ?? 'untitled')}.md`,
      `# ${page.name ?? 'Untitled'}\n\n${htmlToMarkdown(page.description_html ?? '')}\n`,
    );
  }

  const commentCount = Object.values(comments).reduce((total, rows) => total + rows.length, 0);
  summaryRows.push(
    `| ${project.name} | ${project.identifier} | ${issues.length} | ${states.length} | ${labels.length} | ` +
      `${cycles.length} | ${modules.length} | ${pageDetails.length} | ${commentCount} |`,
  );
  log(
    `${project.identifier}: done. ${issues.length} issues, ${commentCount} comments, ${pageDetails.length} pages`,
  );
}

await writeText(
  OUT,
  'SUMMARY.md',
  [
    '# Plane export: noveum-ai',
    '',
    `Fetched ${new Date().toISOString()}`,
    '',
    `- ${projects.length} projects`,
    `- ${members.length} workspace members`,
    `- ${workspacePages.length} workspace pages`,
    '',
    '| Project | Key | Issues | States | Labels | Cycles | Modules | Pages | Comments |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summaryRows,
    '',
  ].join('\n'),
);

for (const page of workspacePages) {
  for (const assetId of assetIdsIn(page.description_html)) await downloadAsset(assetId);
}

await writeJson(OUT, 'assets', assetManifest);
log(`assets: ${Object.keys(assetManifest).length}`);

if (inaccessible.length > 0) {
  await writeJson(OUT, 'inaccessible', inaccessible);
  log(`no permission to read: ${inaccessible.join(', ')}`);
}
log(`done in ${requests} requests (${throttled} throttled), cached in ${OUT}`);
