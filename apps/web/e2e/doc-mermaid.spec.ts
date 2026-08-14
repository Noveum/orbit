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
  await expect(blocks).toHaveCount(3);
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

  await blocks.nth(0).hover();
  await blocks.nth(0).locator('[data-mermaid-toggle]').click();
  await expect(blocks.nth(0)).toHaveAttribute('data-mermaid-view', 'source');
  await expect(blocks.nth(0)).toContainText('graph TD');

  await context.close();
});
