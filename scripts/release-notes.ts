#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises';
import {
  commitPageSchema,
  type GitHubCommit,
  type GitHubRelease,
  type PullRequest,
  pullRequestListSchema,
  releaseListSchema,
} from '@orbit/shared/validators';

const repo = process.env['GITHUB_REPOSITORY'] ?? '';
const token = process.env['GITHUB_TOKEN'] ?? '';
const targetSha = process.env['RELEASE_TARGET_SHA'] ?? '';

function getRepositoryParts(): { owner: string; repoName: string } {
  const parts = repo.split('/');

  if (parts.length !== 2) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repo}`);
  }

  const [owner, repoName] = parts;

  if (!(owner && repoName)) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repo}`);
  }

  return { owner, repoName };
}

const headers: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'orbit-release-bot',
};
if (token) headers['Authorization'] = `Bearer ${token}`;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub API returned invalid JSON: ${url}`);
  }
}

async function runGit(args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

function isDatedReleaseTag(tag: string): boolean {
  return /^\d{4}\.\d{2}\.\d{2}(?:-\d+)?$/.test(tag);
}

export function selectLatestPublishedRelease(releases: GitHubRelease[]): GitHubRelease | null {
  const published = releases.filter(
    (release) =>
      !(release.draft || release.prerelease) &&
      release.published_at !== null &&
      isDatedReleaseTag(release.tag_name),
  );

  return (
    published.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0] ?? null
  );
}

async function getReleaseBoundary(): Promise<{
  baseSha: string;
  publishedTags: Set<string>;
}> {
  const { owner, repoName } = getRepositoryParts();
  const published: GitHubRelease[] = [];

  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${owner}/${repoName}/releases?per_page=100&page=${page}`;
    const releases = releaseListSchema.parse(await fetchJson(url));
    if (releases.length === 0) break;

    published.push(
      ...releases.filter(
        (release) =>
          !(release.draft || release.prerelease) &&
          release.published_at !== null &&
          isDatedReleaseTag(release.tag_name),
      ),
    );

    if (releases.length < 100) break;
  }

  const latest = selectLatestPublishedRelease(published);
  const publishedTags = new Set(published.map((release) => release.tag_name));

  if (latest) {
    const baseSha = await runGit(['rev-list', '-n', '1', `${latest.tag_name}^{commit}`]);
    return { baseSha, publishedTags };
  }

  const baseSha = await runGit(['rev-list', '--max-parents=0', targetSha]);
  return { baseSha, publishedTags };
}

type TagAction = 'create' | 'reuse' | 'repair';

export function selectDatedTag(
  baseTag: string,
  targetSha: string,
  existingTags: Record<string, string>,
  publishedTags: Set<string>,
): { tag: string; action: TagAction } {
  let count = 0;

  while (true) {
    const tag = count === 0 ? baseTag : `${baseTag}-${count}`;
    const existingSha = existingTags[tag];

    if (!existingSha) {
      return { tag, action: 'create' };
    }

    if (existingSha === targetSha) {
      return { tag, action: 'reuse' };
    }

    if (!publishedTags.has(tag)) {
      return { tag, action: 'repair' };
    }

    count += 1;
  }
}
async function getExistingDatedTags(baseTag: string): Promise<Record<string, string>> {
  const output = await runGit([
    'for-each-ref',
    'refs/tags',
    '--format=%(refname:strip=2) %(objectname)',
  ]);
  const tags: Record<string, string> = {};

  for (const line of output.split('\n')) {
    const [tag] = line.split(' ');
    if (!tag?.startsWith(baseTag)) continue;
    if (!isDatedReleaseTag(tag)) continue;
    tags[tag] = await runGit(['rev-list', '-n', '1', `${tag}^{commit}`]);
  }

  return tags;
}

async function writeGitHubOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env['GITHUB_OUTPUT'];
  if (!outputPath) return;
  await writeFile(outputPath, `${name}=${value}\n`, { flag: 'a' });
}

async function fetchCommitPage(page: number): Promise<GitHubCommit[]> {
  const { owner, repoName } = getRepositoryParts();
  const url = `https://api.github.com/repos/${owner}/${repoName}/commits?sha=${targetSha}&per_page=100&page=${page}`;
  return commitPageSchema.parse(await fetchJson(url));
}

async function fetchPullRequestsForCommit(sha: string): Promise<PullRequest[]> {
  const { owner, repoName } = getRepositoryParts();
  const url = `https://api.github.com/repos/${owner}/${repoName}/commits/${sha}/pulls`;
  return pullRequestListSchema.parse(await fetchJson(url));
}

export function collectCommitsInRange(baseSha: string, pages: GitHubCommit[][]): GitHubCommit[] {
  const commits: GitHubCommit[] = [];

  for (const page of pages) {
    for (const commit of page) {
      if (commit.sha === baseSha) return commits;
      commits.push(commit);
    }

    if (page.length < 100) {
      throw new Error(`Release base ${baseSha} was not found in the main history`);
    }
  }

  throw new Error(`Release base ${baseSha} was not found in the main history`);
}
async function collectPullRequests(baseSha: string): Promise<PullRequest[]> {
  const pages: GitHubCommit[][] = [];

  for (let page = 1; ; page++) {
    const pageCommits = await fetchCommitPage(page);
    pages.push(pageCommits);

    if (pageCommits.some((commit) => commit.sha === baseSha)) break;
    if (pageCommits.length < 100) {
      throw new Error(`Release base ${baseSha} was not found in the main history`);
    }
  }

  const commits = collectCommitsInRange(baseSha, pages);
  const prs = new Map<number, PullRequest>();

  for (const commit of commits) {
    const associatedPRs = await fetchPullRequestsForCommit(commit.sha);
    for (const pr of associatedPRs) {
      if (isMainReleasePR(pr)) prs.set(pr.number, pr);
    }
  }

  return [...prs.values()].sort((a, b) => a.number - b.number);
}

export function isMainReleasePR(pr: PullRequest): boolean {
  return Boolean(pr.merged_at) && pr.base.ref === 'main';
}

export function groupByArea(prs: PullRequest[]) {
  const areas: Record<string, PullRequest[]> = {};
  const breaking: PullRequest[] = [];

  for (const pr of prs) {
    const labels = pr.labels.map((label) => label.name);
    const hasBreakingLabel = labels.some((name) => name.toLowerCase() === 'breaking change');
    const hasBreakingBody = /\bBREAKING CHANGE\b/i.test(pr.body ?? '');

    if (hasBreakingLabel || hasBreakingBody) {
      breaking.push(pr);
      continue;
    }

    const area = labels.find((name) => name.startsWith('area:')) ?? 'Other';
    areas[area] ??= [];
    areas[area].push(pr);
  }

  return { areas, breaking };
}

export function renderNotes(prs: PullRequest[], baseSha: string, targetSha: string): string {
  const { areas, breaking } = groupByArea(prs);
  let body = `Automated release for ${targetSha}\n\n`;
  body += `Changes: ${baseSha}..${targetSha}\n\n`;

  if (breaking.length) {
    body += '## Breaking changes\n\n';
    body +=
      '> Action required: review the linked pull requests for database migrations, ' +
      'new environment variables, or other deployment changes before upgrading.\n\n';
    for (const pr of breaking) {
      body += `- ${pr.title} (#${pr.number}) ${pr.html_url}\n`;
      if (pr.body) {
        const excerpt = pr.body.split(/\r?\n/).slice(0, 6).join('\n  ').trim();
        if (excerpt) body += `\n  ${excerpt}\n`;
      }
    }
    body += '\n';
  }

  for (const area of Object.keys(areas).sort()) {
    const title = area === 'Other' ? area : area.replace(/^area:/, 'Area: ');
    body += `## ${title}\n`;
    for (const pr of areas[area] ?? []) {
      body += `- ${pr.title} (#${pr.number}) ${pr.html_url}\n`;
    }
    body += '\n';
  }

  if (!breaking.length && Object.keys(areas).length === 0) {
    body += 'No merged pull requests found in this release range.\n';
  }

  return body;
}

async function main(): Promise<void> {
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is not set');
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN is not set');
  }
  if (!targetSha) {
    throw new Error('RELEASE_TARGET_SHA is not set');
  }

  const checkedOutSha = await runGit(['rev-parse', 'HEAD']);
  if (checkedOutSha !== targetSha) {
    throw new Error(`Checked-out main is ${checkedOutSha}, expected release target ${targetSha}`);
  }

  const { baseSha, publishedTags } = await getReleaseBoundary();
  const prs = await collectPullRequests(baseSha);
  const notes = renderNotes(prs, baseSha, targetSha);
  const baseTag = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
  const existingTags = await getExistingDatedTags(baseTag);
  const selectedTag = selectDatedTag(baseTag, targetSha, existingTags, publishedTags);
  await writeFile('RELEASE_NOTES.md', notes, 'utf8');
  await writeGitHubOutput('tag', selectedTag.tag);
  await writeGitHubOutput('reuse_tag', String(selectedTag.action));
  console.log(`Release range: ${baseSha}..${targetSha}`);
  console.log(`Release PRs: ${prs.length}`);
  console.log('WROTE RELEASE_NOTES.md');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error('Failed to generate release notes:', error);
    process.exitCode = 2;
  });
}
