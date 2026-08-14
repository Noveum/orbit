import purify from 'dompurify';
import type { MermaidConfig } from 'mermaid';
import { cn } from '@/lib/cn.ts';

export const MERMAID_BLOCK = '[data-mermaid]';
export const DIAGRAM_VIEW = 'diagram';
export const SOURCE_VIEW = 'source';
export const SHOW_SOURCE_LABEL = 'Show the diagram source';
export const SHOW_DIAGRAM_LABEL = 'Show the diagram';
export const DIAGRAM_FAILED = 'This diagram could not be drawn.';
export const DIAGRAM_UNAVAILABLE = 'The diagram renderer could not be loaded.';

export const mermaidClassName = cn(
  '[&_[data-mermaid]]:relative [&_[data-mermaid]]:my-5',
  '[&_[data-mermaid]]:rounded-lg [&_[data-mermaid]]:border [&_[data-mermaid]]:border-border [&_[data-mermaid]]:bg-surface-2',
  '[&_[data-mermaid][data-mermaid-view=diagram]_pre]:hidden',
  '[&_[data-mermaid]_pre]:my-0 [&_[data-mermaid]_pre]:rounded-lg [&_[data-mermaid]_pre]:border-0 [&_[data-mermaid]_pre]:bg-transparent',
  '[&_[data-mermaid-canvas]]:flex [&_[data-mermaid-canvas]]:justify-center [&_[data-mermaid-canvas]]:overflow-x-auto',
  '[&_[data-mermaid-canvas]]:px-4 [&_[data-mermaid-canvas]]:py-6',
  '[&_[data-mermaid-canvas]_svg]:h-auto [&_[data-mermaid-canvas]_svg]:max-w-full',
  '[&_[data-mermaid][data-mermaid-view=source]_[data-mermaid-canvas]]:hidden',
  '[&_[data-mermaid-note]]:m-0 [&_[data-mermaid-note]]:border-border [&_[data-mermaid-note]]:border-b',
  '[&_[data-mermaid-note]]:px-4 [&_[data-mermaid-note]]:py-2 [&_[data-mermaid-note]]:text-2xs [&_[data-mermaid-note]]:text-danger',
  '[&_[data-mermaid-toggle]]:absolute [&_[data-mermaid-toggle]]:top-2 [&_[data-mermaid-toggle]]:right-2',
  '[&_[data-mermaid-toggle]]:cursor-pointer [&_[data-mermaid-toggle]]:rounded-sm [&_[data-mermaid-toggle]]:border [&_[data-mermaid-toggle]]:border-border',
  '[&_[data-mermaid-toggle]]:bg-surface [&_[data-mermaid-toggle]]:px-1.5 [&_[data-mermaid-toggle]]:py-0.5',
  '[&_[data-mermaid-toggle]]:text-2xs [&_[data-mermaid-toggle]]:text-muted',
  '[&_[data-mermaid-toggle]]:opacity-0 [&_[data-mermaid-toggle]]:transition-opacity [&_[data-mermaid-toggle]]:duration-[var(--duration-fast)]',
  '[&_[data-mermaid]:hover_[data-mermaid-toggle]]:opacity-100',
  '[&_[data-mermaid]:focus-within_[data-mermaid-toggle]]:opacity-100',
  '[&_[data-mermaid][data-mermaid-view=source]_[data-mermaid-toggle]]:opacity-100',
  'motion-reduce:[&_[data-mermaid-toggle]]:transition-none',
);

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length === 0 ? fallback : value;
}

export function mermaidConfig(styles: CSSStyleDeclaration, dark: boolean): MermaidConfig {
  const surface = token(styles, '--orbit-surface', dark ? '#16181d' : '#ffffff');
  const surfaceTwo = token(styles, '--orbit-surface-2', dark ? '#1c1f26' : '#eef0f3');
  const surfaceThree = token(styles, '--orbit-surface-3', dark ? '#22262e' : '#e9ebef');
  const border = token(styles, '--orbit-border', dark ? '#2f343d' : '#d8dbe1');
  const borderStrong = token(styles, '--orbit-border-strong', dark ? '#414852' : '#c2c6ce');
  const text = token(styles, '--orbit-text', dark ? '#e6e8ee' : '#1c1f27');
  const muted = token(styles, '--orbit-muted', dark ? '#9aa0ad' : '#4b5060');
  const accent = token(styles, '--orbit-accent', '#4d57bd');
  const accentSoft = token(styles, '--orbit-accent-soft', dark ? '#242741' : '#e6e8fa');
  const success = token(styles, '--orbit-success', '#12724c');
  const warning = token(styles, '--orbit-warning', '#96570c');
  const danger = token(styles, '--orbit-danger', '#ba3237');
  const merged = token(styles, '--orbit-merged', '#6c3fc7');
  const link = token(styles, '--orbit-link', '#2f5fd1');

  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    darkMode: dark,
    fontFamily: token(styles, '--font-sans', 'system-ui, sans-serif'),
    htmlLabels: false,
    flowchart: { useMaxWidth: true, htmlLabels: false, curve: 'basis' },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    themeVariables: {
      background: surfaceTwo,
      fontSize: '14px',
      primaryColor: accentSoft,
      primaryTextColor: text,
      primaryBorderColor: accent,
      secondaryColor: surfaceThree,
      secondaryTextColor: text,
      secondaryBorderColor: borderStrong,
      tertiaryColor: surface,
      tertiaryTextColor: text,
      tertiaryBorderColor: border,
      mainBkg: accentSoft,
      nodeBorder: accent,
      nodeTextColor: text,
      textColor: text,
      titleColor: text,
      lineColor: borderStrong,
      edgeLabelBackground: surface,
      clusterBkg: surface,
      clusterBorder: border,
      noteBkgColor: surfaceThree,
      noteTextColor: text,
      noteBorderColor: border,
      actorBkg: accentSoft,
      actorBorder: accent,
      actorTextColor: text,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: border,
      labelTextColor: text,
      altBackground: surface,
      signalColor: muted,
      signalTextColor: text,
      pie1: accent,
      pie2: success,
      pie3: warning,
      pie4: merged,
      pie5: link,
      pie6: danger,
      pieStrokeColor: surfaceTwo,
      pieOuterStrokeColor: border,
      pieTitleTextColor: text,
      pieSectionTextColor: surface,
      pieLegendTextColor: text,
      git0: accent,
      git1: success,
      git2: warning,
      git3: merged,
      git4: link,
      git5: danger,
      gitBranchLabel0: text,
    },
  };
}

function toggleButton(document: Document, view: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-mermaid-toggle', '');
  applyView(button, view);
  button.addEventListener('click', () => {
    const block = button.closest<HTMLElement>(MERMAID_BLOCK);
    if (block === null) return;
    const next =
      block.getAttribute('data-mermaid-view') === DIAGRAM_VIEW ? SOURCE_VIEW : DIAGRAM_VIEW;
    block.setAttribute('data-mermaid-view', next);
    applyView(button, next);
  });
  return button;
}

function applyView(button: HTMLButtonElement, view: string): void {
  const showsDiagram = view === DIAGRAM_VIEW;
  button.textContent = showsDiagram ? 'Source' : 'Diagram';
  button.setAttribute('aria-label', showsDiagram ? SHOW_SOURCE_LABEL : SHOW_DIAGRAM_LABEL);
}

function noteOf(block: HTMLElement, message: string): void {
  const existing = block.querySelector('[data-mermaid-note]');
  if (existing !== null) existing.remove();
  const note = block.ownerDocument.createElement('p');
  note.setAttribute('data-mermaid-note', '');
  note.textContent = message;
  block.prepend(note);
}

function sourceOf(block: HTMLElement): string {
  return block.querySelector('code')?.textContent ?? '';
}

let sequence = 0;

function drawInto(block: HTMLElement, svg: string, source: string): void {
  const document = block.ownerDocument;
  block.querySelector('[data-mermaid-note]')?.remove();
  let canvas = block.querySelector<HTMLElement>('[data-mermaid-canvas]');
  if (canvas === null) {
    canvas = document.createElement('div');
    canvas.setAttribute('data-mermaid-canvas', '');
    block.prepend(canvas);
  }
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Diagram: ${source.split('\n')[0] ?? ''}`.trim());
  canvas.innerHTML = svg;
  block.setAttribute('data-mermaid-view', DIAGRAM_VIEW);
  if (block.querySelector('[data-mermaid-toggle]') === null) {
    block.append(toggleButton(document, DIAGRAM_VIEW));
  }
}

function failInto(block: HTMLElement, message = DIAGRAM_FAILED): void {
  block.querySelector('[data-mermaid-canvas]')?.remove();
  block.querySelector('[data-mermaid-toggle]')?.remove();
  block.setAttribute('data-mermaid-view', SOURCE_VIEW);
  noteOf(block, message);
}

export function safeSvg(svg: string): string {
  return purify.sanitize(svg, { ADD_ATTR: ['transform-origin'] });
}

export interface MermaidRenderer {
  initialize(config: MermaidConfig): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

async function load(): Promise<MermaidRenderer> {
  const module = await import('mermaid');
  return module.default as unknown as MermaidRenderer;
}

function configure(mermaid: MermaidRenderer, theme: string, document: Document): void {
  const styles = document.defaultView?.getComputedStyle(document.documentElement);
  if (styles !== undefined) mermaid.initialize(mermaidConfig(styles, theme === 'dark'));
}

async function drawOne(
  mermaid: MermaidRenderer,
  source: string,
  document: Document,
): Promise<string | null> {
  sequence += 1;
  const id = `orbit-mermaid-${sequence}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return safeSvg(svg);
  } catch {
    return null;
  } finally {
    document.getElementById(`d${id}`)?.remove();
  }
}

export async function renderDiagram(
  source: string,
  theme: string,
  document: Document,
  renderer: () => Promise<MermaidRenderer> = load,
): Promise<string | null> {
  const text = source.trim();
  if (text.length === 0) return null;
  const mermaid = await renderer();
  configure(mermaid, theme, document);
  return drawOne(mermaid, text, document);
}

let pass = 0;

export async function drawDiagrams(
  root: HTMLElement,
  theme: string,
  renderer: () => Promise<MermaidRenderer> = load,
): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(MERMAID_BLOCK)].filter(
    (block) => block.getAttribute('data-mermaid-drawn') !== theme,
  );
  if (blocks.length === 0) return;
  for (const block of blocks) block.setAttribute('data-mermaid-drawn', theme);

  pass += 1;
  const mine = pass;
  const document = root.ownerDocument;

  let mermaid: MermaidRenderer;
  try {
    mermaid = await renderer();
  } catch {
    if (mine === pass) for (const block of blocks) failInto(block, DIAGRAM_UNAVAILABLE);
    return;
  }
  if (mine !== pass) return;
  configure(mermaid, theme, document);

  for (const block of blocks) {
    const source = sourceOf(block).trim();
    const svg = source.length === 0 ? null : await drawOne(mermaid, source, document);
    if (mine !== pass) return;
    if (svg === null) {
      failInto(block);
      continue;
    }
    drawInto(block, svg, source);
  }
}
