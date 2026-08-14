import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const CONTENT = [
  '## Diagrams',
  '',
  '```mermaid',
  'graph TD',
  '  A[Client mutation] --> B[Route handler]',
  '  B --> C[(Postgres)]',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A["<img src=x onerror=alert(1)>"] --> B["<script>alert(2)</script>"]',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A[Start --> B]]]',
  '```',
  '',
  '```mermaid',
  'graph LR',
  '  U[Users and SDKs] --> CF[Cloudflare DNS<br/>authoritative]',
  '  CF --> CFR[CloudFront distribution<br/>plus WAF]',
  '  CFR --> ALB[Load balancer<br/>tls termination]',
  '  ALB --> ING[Ingress controller<br/>9 host rules]',
  '  ING --> SVC[Service mesh sidecar<br/>mutual tls]',
  '  SVC --> APP[traces app<br/>eu west and us east]',
  '  APP --> Q[Ingest queue<br/>partitioned by workspace]',
  '  Q --> W[Rollup workers<br/>five minute windows]',
  '  style CFR fill:#e8f0fe',
  '```',
  '',
  '```mermaid',
  'graph LR',
  '  A[Route handler] --> B[(Postgres)]',
  '  B --> C[Redis fan out]',
  '  C --> D[Subscribed clients]',
  '```',
  '',
].join('\n');

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('a mermaid fence is drawn as a diagram, sanitised, and falls back to its source', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const author = await signIn(context, 'alex@orbit.example');

  const created = await author.evaluate(async (content) => {
    const response = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Diagram spec', content, visibility: 'workspace' }),
    });
    if (!response.ok) throw new Error(`create answered ${response.status}`);
    return (await response.json()) as { doc: { id: string } };
  }, CONTENT);

  const shared = await author.evaluate(async (id) => {
    const response = await fetch(`/api/docs/${id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'public' }),
    });
    if (!response.ok) throw new Error(`share answered ${response.status}`);
    return (await response.json()) as { publishUrl: string };
  }, created.doc.id);

  const reader = await context.newPage();
  await reader.goto(shared.publishUrl);

  const blocks = reader.locator('[data-mermaid]');
  await expect(blocks).toHaveCount(5);
  await expect(blocks.nth(0).locator('svg')).toBeVisible();
  await expect(blocks.nth(0)).toHaveAttribute('data-mermaid-view', 'diagram');

  await expect(blocks.nth(2)).toHaveAttribute('data-mermaid-view', 'source');
  await expect(blocks.nth(2)).toContainText('This diagram could not be drawn.');
  await expect(blocks.nth(2)).toContainText('graph TD');

  const unsafe = await reader.evaluate(() => {
    const drawn = [...document.querySelectorAll('[data-mermaid-canvas]')];
    return {
      scripts: drawn.filter((node) => node.querySelector('script') !== null).length,
      handlers: drawn.filter((node) => node.innerHTML.includes('onerror')).length,
      images: drawn.filter((node) => node.querySelector('img') !== null).length,
    };
  });
  expect(unsafe).toEqual({ scripts: 0, handlers: 0, images: 0 });

  const wide = blocks.nth(3);
  await expect(wide.locator('svg')).toBeVisible();
  const scale = await wide.evaluate((block) => {
    const canvas = block.querySelector('[data-mermaid-canvas]');
    const svg = canvas?.querySelector('svg');
    return {
      natural: Math.round(svg?.getBoundingClientRect().width ?? 0),
      column: canvas?.clientWidth ?? 0,
      squeezed: block.hasAttribute('data-mermaid-fit'),
    };
  });
  expect(scale.squeezed).toBe(false);
  expect(scale.natural).toBeGreaterThan(scale.column);
  await expect(wide.locator('[data-mermaid-scale]')).toHaveCount(1);

  const ink = await wide.evaluate((block) => {
    const pale = [...block.querySelectorAll('.node')].find((node) => {
      const fill = getComputedStyle(node.querySelector('rect, polygon, path') as Element).fill;
      return fill === 'rgb(232, 240, 254)';
    });
    const label = pale?.querySelector('text, tspan');
    return label === null || label === undefined ? null : getComputedStyle(label).fill;
  });
  expect(ink).toBe('rgb(16, 19, 26)');

  const midsize = blocks.nth(4);
  await expect(midsize).toHaveAttribute('data-mermaid-fit', '');
  await reader.setViewportSize({ width: 520, height: 900 });
  await expect(midsize).not.toHaveAttribute('data-mermaid-fit', '');
  await reader.setViewportSize({ width: 1440, height: 900 });
  await expect(midsize).toHaveAttribute('data-mermaid-fit', '');

  await wide.hover();
  await wide.locator('[data-mermaid-expand]').click();
  const viewer = reader.getByTestId('diagram-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId('diagram-viewport').locator('svg').first()).toBeVisible();

  const opensAt = await reader.getByTestId('diagram-zoom').textContent();
  await viewer.getByLabel('Zoom in').click();
  await expect(reader.getByTestId('diagram-zoom')).not.toHaveText(opensAt ?? '');
  await viewer.getByLabel('Fit the diagram to the viewer').click();
  await expect(reader.getByTestId('diagram-zoom')).toHaveText(opensAt ?? '');

  await reader.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  await blocks.nth(0).hover();
  await blocks.nth(0).locator('[data-mermaid-view-toggle]').click();
  await expect(blocks.nth(0)).toHaveAttribute('data-mermaid-view', 'source');
  await expect(blocks.nth(0)).toContainText('graph TD');

  await context.close();
});
