import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KEY = process.env.PLANE_API_KEY;
const SLUG = process.env.PLANE_WORKSPACE ?? 'noveum-ai';
const OUT = resolve(process.env.PLANE_OUT ?? 'extras/import/plane');
const RATE = Number(process.env.PLANE_RATE ?? 55);
const WITH_LINKS = process.env.PLANE_LINKS === '1';

if (!KEY) throw new Error('PLANE_API_KEY is not set.');

const BASE = `https://api.plane.so/api/v1/workspaces/${SLUG}`;
mkdirSync(OUT, { recursive: true });

const log = (line) => {
  process.stdout.write(`${line}\n`);
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const window = [];
let requests = 0;
let throttled = 0;

async function takeSlot() {
  for (;;) {
    const now = Date.now();
    while (window.length > 0 && now - window[0] > 60_000) window.shift();
    if (window.length < RATE) {
      window.push(now);
      return;
    }
    await sleep(Math.max(250, 60_000 - (now - window[0])));
  }
}

async function get(path, attempt = 0) {
  await takeSlot();
  requests += 1;
  const response = await fetch(BASE + path, { headers: { 'x-api-key': KEY } });
  if (response.status === 429 || response.status >= 500) {
    throttled += 1;
    if (attempt >= 8) throw new Error(`${response.status} on ${path}`);
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    await sleep(retryAfter > 0 ? (retryAfter + 1) * 1000 : 2000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} on ${path}`);
  return response.json();
}

async function collect(path) {
  const rows = [];
  const seen = new Set();
  let cursor = null;
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const suffix = cursor === null ? '' : `${separator}cursor=${encodeURIComponent(cursor)}`;
    const page = await get(`${path}${suffix}`);
    if (Array.isArray(page)) return page;
    rows.push(...page.results);
    if (!page.next_page_results || seen.has(page.next_cursor)) return rows;
    seen.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}

async function mapConcurrent(items, limit, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    }),
  );
}

function writeJson(directory, name, value) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${name}.json`), JSON.stringify(value, null, 2));
}

function writeText(directory, name, value) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, name), value);
}

function htmlToMarkdown(html) {
  if (typeof html !== 'string' || html.length === 0) return '';
  return html
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) =>
      String(text).trim().length === 0 ? String(href) : `[${String(text).trim()}](${href})`,
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

function slugify(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

const IMAGE_TAG = /<image-component[^>]*\bsrc="([0-9a-fA-F-]{36})"/g;
const assetManifest = {};

function assetIdsIn(html) {
  if (typeof html !== 'string') return [];
  return [...html.matchAll(IMAGE_TAG)].map((match) => match[1]);
}

async function downloadAsset(assetId) {
  if (assetManifest[assetId] !== undefined) return;
  const meta = await get(`/assets/${assetId}/`).catch(() => null);
  const url = meta?.asset_url;
  if (typeof url !== 'string' || url.length === 0) return;

  const response = await fetch(url);
  if (!response.ok) return;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const named = /filename[^=]*=(?:UTF-8'')?"?([^&";]+)/i.exec(decodeURIComponent(url));
  const fileName = slugify(named?.[1] ?? 'image').concat(
    (named?.[1] ?? '').includes('.') ? `.${(named?.[1] ?? '').split('.').pop()}` : '.png',
  );
  const directory = resolve(OUT, 'assets');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, assetId), bytes);
  assetManifest[assetId] = {
    fileName,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    size: bytes.byteLength,
  };
  log(`  asset ${assetId} ${fileName} ${bytes.byteLength} bytes`);
}

const projects = await collect('/projects/?per_page=100');
writeJson(OUT, 'projects', projects);
log(`projects: ${projects.length}`);

const members = await get('/members/');
writeJson(OUT, 'members', members);
log(`members: ${members.length}`);

const workspacePages = await collect('/pages/?per_page=100').catch(() => []);
writeJson(OUT, 'workspace-pages', workspacePages);
log(`workspace pages: ${workspacePages.length}`);

const summaryRows = [];
const inaccessible = [];

for (const project of projects) {
  const id = project.id;
  const directory = resolve(OUT, project.identifier);

  if (existsSync(resolve(directory, 'issues.json')) && process.env.PLANE_FORCE !== '1') {
    log(`${project.identifier}: cached, skipping`);
    continue;
  }

  log(`${project.identifier}: fetching metadata`);
  const states = await collect(`/projects/${id}/states/?per_page=100`).catch((error) => {
    if (String(error).includes('403')) return null;
    throw error;
  });
  if (states === null) {
    log(`${project.identifier}: no permission to read this project, skipping`);
    inaccessible.push(project.identifier);
    continue;
  }
  const labels = await collect(`/projects/${id}/labels/?per_page=100`);
  const cycles = await collect(`/projects/${id}/cycles/?per_page=100`);
  const modules = await collect(`/projects/${id}/modules/?per_page=100`);
  const projectMembers = await get(`/projects/${id}/members/`).catch(() => []);
  const issueTypes = await get(`/projects/${id}/issue-types/`).catch(() => []);
  const pages = await collect(`/projects/${id}/pages/?per_page=100`).catch(() => []);

  const issues = await collect(`/projects/${id}/issues/?per_page=100`);
  log(`${project.identifier}: ${issues.length} issues, fetching comments`);

  const cycleIssues = {};
  for (const item of cycles) {
    const rows = await collect(
      `/projects/${id}/cycles/${item.id}/cycle-issues/?per_page=100`,
    ).catch(() => []);
    cycleIssues[item.id] = rows.map((row) => row.issue ?? row.id);
  }

  const moduleIssues = {};
  for (const item of modules) {
    const rows = await collect(
      `/projects/${id}/modules/${item.id}/module-issues/?per_page=100`,
    ).catch(() => []);
    moduleIssues[item.id] = rows.map((row) => row.issue ?? row.id);
  }

  const comments = {};
  let done = 0;
  await mapConcurrent(issues, 4, async (item) => {
    const rows = await collect(`/projects/${id}/issues/${item.id}/comments/?per_page=100`).catch(
      () => [],
    );
    if (rows.length > 0) comments[item.id] = rows;
    done += 1;
    if (done % 50 === 0) log(`  ${project.identifier}: ${done}/${issues.length} comment threads`);
  });

  const links = {};
  if (WITH_LINKS) {
    await mapConcurrent(issues, 4, async (item) => {
      const rows = await collect(`/projects/${id}/issues/${item.id}/links/?per_page=100`).catch(
        () => [],
      );
      if (rows.length > 0) links[item.id] = rows;
    });
  }

  const pageDetails = [];
  await mapConcurrent(pages, 2, async (page) => {
    const detail = await get(`/projects/${id}/pages/${page.id}/`).catch(() => page);
    pageDetails.push(detail);
  });

  const referenced = new Set();
  for (const item of issues)
    for (const asset of assetIdsIn(item.description_html)) referenced.add(asset);
  for (const rows of Object.values(comments))
    for (const row of rows) for (const asset of assetIdsIn(row.comment_html)) referenced.add(asset);
  for (const page of pageDetails)
    for (const asset of assetIdsIn(page.description_html)) referenced.add(asset);
  for (const assetId of referenced) await downloadAsset(assetId);

  writeJson(directory, 'project', project);
  writeJson(directory, 'states', states);
  writeJson(directory, 'labels', labels);
  writeJson(directory, 'cycles', cycles);
  writeJson(directory, 'modules', modules);
  writeJson(directory, 'members', projectMembers);
  writeJson(directory, 'issue-types', issueTypes);
  writeJson(directory, 'cycle-issues', cycleIssues);
  writeJson(directory, 'module-issues', moduleIssues);
  writeJson(directory, 'comments', comments);
  writeJson(directory, 'links', links);
  writeJson(directory, 'pages', pageDetails);
  writeJson(directory, 'issues', issues);

  const stateById = new Map(states.map((row) => [row.id, row]));
  const memberById = new Map(projectMembers.map((row) => [row.id, row]));
  const labelById = new Map(labels.map((row) => [row.id, row]));

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
  writeText(directory, 'issues.md', readable.join('\n'));

  for (const page of pageDetails) {
    writeText(
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

writeText(
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

writeJson(OUT, 'assets', assetManifest);
log(`assets: ${Object.keys(assetManifest).length}`);

if (inaccessible.length > 0) {
  writeJson(OUT, 'inaccessible', inaccessible);
  log(`no permission to read: ${inaccessible.join(', ')}`);
}
log(`done in ${requests} requests (${throttled} throttled), cached in ${OUT}`);
