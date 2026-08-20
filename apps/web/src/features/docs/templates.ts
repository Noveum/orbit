export interface DocTemplate {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly content: string;
  readonly kind: 'markdown' | 'html';
}

export const HTML_PAGE_STARTER = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  '<title>Untitled page</title>',
  '<style>',
  '  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }',
  '  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }',
  '  main { max-width: 40rem; padding: 2rem; }',
  '  h1 { margin: 0 0 0.5rem; font-size: 1.75rem; }',
  '  p { margin: 0; color: color-mix(in srgb, CanvasText 62%, Canvas); }',
  '</style>',
  '</head>',
  '<body>',
  '  <main>',
  '    <h1>Untitled page</h1>',
  '    <p>A self-contained HTML page. CSS and script stay in this file.</p>',
  '  </main>',
  '</body>',
  '</html>',
  '',
].join('\n');

export const DOC_TEMPLATES: readonly DocTemplate[] = [
  {
    id: 'blank',
    name: 'Blank doc',
    title: 'Untitled doc',
    kind: 'markdown',
    content: '# Untitled doc\n\nStart writing.\n',
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    title: 'Meeting notes',
    kind: 'markdown',
    content: [
      '# Meeting notes',
      '',
      '**Note**',
      'Add the date, the attendees, and the one decision this meeting has to produce.',
      '',
      '## Agenda',
      '',
      '- ',
      '',
      '## Decisions',
      '',
      '- ',
      '',
      '## Actions',
      '',
      '- [ ] Owner: what, by when',
      '',
    ].join('\n'),
  },
  {
    id: 'product-spec',
    name: 'Product spec',
    title: 'Product spec',
    kind: 'markdown',
    content: [
      '# Product spec',
      '',
      '## Problem',
      '',
      'Who hurts, how often, and what it costs them today.',
      '',
      '## Proposal',
      '',
      '## Out of scope',
      '',
      '## Rollout',
      '',
      '| Stage | Owner | Date |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
    ].join('\n'),
  },
  {
    id: 'runbook',
    name: 'Runbook',
    title: 'Runbook',
    kind: 'markdown',
    content: [
      '# Runbook',
      '',
      '> **Warning**',
      '> Read the rollback step before you start.',
      '',
      '## Preconditions',
      '',
      '- [ ] ',
      '',
      '## Steps',
      '',
      '1. ',
      '',
      '## Rollback',
      '',
      '```bash',
      '# the exact command',
      '```',
      '',
    ].join('\n'),
  },
  {
    id: 'html-page',
    name: 'HTML page',
    title: 'Untitled page',
    kind: 'html',
    content: HTML_PAGE_STARTER,
  },
];

export function templateById(id: string | null): DocTemplate {
  const fallback = DOC_TEMPLATES[0] ?? {
    id: 'blank',
    name: 'Blank doc',
    title: 'Untitled doc',
    kind: 'markdown',
    content: '',
  };
  if (id === null) return fallback;
  return DOC_TEMPLATES.find((template) => template.id === id) ?? fallback;
}
