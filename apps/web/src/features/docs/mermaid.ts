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
export const FIT_LABEL = 'Fit the diagram to the column';
export const ACTUAL_LABEL = 'Show the diagram at its own size';
export const LEGIBLE_SCALE = 0.75;
export const DARK_INK = '#10131a';
export const LIGHT_INK = '#f4f5f7';
export const PALE_FILL = 0.55;
export const EXPAND_LABEL = 'Open the diagram in a viewer';
export const DIAGRAM_LABEL = 'Diagram';
export const DIAGRAM_OPEN_EVENT = 'orbit:diagram-open';

export interface DiagramOpenDetail {
  readonly svg: string;
  readonly label: string;
}

export const mermaidClassName = cn(
  '[&_[data-mermaid]]:relative [&_[data-mermaid]]:my-5',
  '[&_[data-mermaid]]:rounded-lg [&_[data-mermaid]]:border [&_[data-mermaid]]:border-border [&_[data-mermaid]]:bg-surface-2',
  '[&_[data-mermaid][data-mermaid-view=diagram]_pre]:hidden',
  '[&_[data-mermaid]_pre]:my-0 [&_[data-mermaid]_pre]:rounded-lg [&_[data-mermaid]_pre]:border-0 [&_[data-mermaid]_pre]:bg-transparent',
  '[&_[data-mermaid-canvas]]:overflow-x-auto [&_[data-mermaid-canvas]]:px-4 [&_[data-mermaid-canvas]]:py-6',
  '[&_[data-mermaid-canvas]_svg]:mx-auto [&_[data-mermaid-canvas]_svg]:block [&_[data-mermaid-canvas]_svg]:h-auto',
  '[&_[data-mermaid-canvas]_svg]:max-w-none',
  '[&_[data-mermaid][data-mermaid-fit]_[data-mermaid-canvas]_svg]:max-w-full',
  '[&_[data-mermaid][data-mermaid-view=source]_[data-mermaid-canvas]]:hidden',
  '[&_[data-mermaid-note]]:m-0 [&_[data-mermaid-note]]:border-border [&_[data-mermaid-note]]:border-b',
  '[&_[data-mermaid-note]]:px-4 [&_[data-mermaid-note]]:py-2 [&_[data-mermaid-note]]:text-2xs [&_[data-mermaid-note]]:text-danger',
  '[&_[data-mermaid-actions]]:absolute [&_[data-mermaid-actions]]:top-2 [&_[data-mermaid-actions]]:right-2',
  '[&_[data-mermaid-actions]]:flex [&_[data-mermaid-actions]]:gap-1',
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
    flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis' },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
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

function actionButton(document: Document): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-mermaid-toggle', '');
  return button;
}

function viewButton(document: Document, view: string): HTMLButtonElement {
  const button = actionButton(document);
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

function expandButton(document: Document): HTMLButtonElement {
  const button = actionButton(document);
  button.setAttribute('data-mermaid-expand', '');
  button.textContent = 'Expand';
  button.setAttribute('aria-label', EXPAND_LABEL);
  button.addEventListener('click', () => {
    const block = button.closest<HTMLElement>(MERMAID_BLOCK);
    const canvas = block?.querySelector('[data-mermaid-canvas]') ?? null;
    if (block === null || canvas === null) return;
    const detail: DiagramOpenDetail = {
      svg: canvas.innerHTML,
      label: canvas.getAttribute('aria-label') ?? 'Diagram',
    };
    block.dispatchEvent(new CustomEvent(DIAGRAM_OPEN_EVENT, { detail, bubbles: true }));
  });
  return button;
}

function scaleButton(document: Document): HTMLButtonElement {
  const button = actionButton(document);
  button.setAttribute('data-mermaid-scale', '');
  applyScale(button, false);
  button.addEventListener('click', () => {
    const block = button.closest<HTMLElement>(MERMAID_BLOCK);
    if (block === null) return;
    const fits = !block.hasAttribute('data-mermaid-fit');
    block.toggleAttribute('data-mermaid-fit', fits);
    block.setAttribute('data-mermaid-scaled-by-hand', '');
    applyScale(button, fits);
  });
  return button;
}

function applyScale(button: HTMLButtonElement, fits: boolean): void {
  button.textContent = fits ? 'Actual size' : 'Fit';
  button.setAttribute('aria-label', fits ? ACTUAL_LABEL : FIT_LABEL);
}

export function fitsTheColumn(natural: number, available: number): boolean {
  if (natural <= 0 || available <= 0) return false;
  if (natural <= available) return true;
  return available / natural >= LEGIBLE_SCALE;
}

function actionsOf(block: HTMLElement): HTMLElement {
  const existing = block.querySelector<HTMLElement>('[data-mermaid-actions]');
  if (existing !== null) return existing;
  const actions = block.ownerDocument.createElement('div');
  actions.setAttribute('data-mermaid-actions', '');
  block.append(actions);
  return actions;
}

export function naturalWidth(drawn: SVGSVGElement): number {
  const box = drawn.viewBox?.baseVal ?? null;
  if (box !== null && box.width > 0) return box.width;
  const declared = Number.parseFloat(drawn.getAttribute('width') ?? '');
  if (Number.isFinite(declared) && declared > 0) return declared;
  return drawn.getBoundingClientRect().width;
}

const widthWatchers = new WeakMap<HTMLElement, ResizeObserver>();

function unwatchWidth(canvas: HTMLElement): void {
  widthWatchers.get(canvas)?.disconnect();
  widthWatchers.delete(canvas);
}

function watchWidth(block: HTMLElement, canvas: HTMLElement): void {
  unwatchWidth(canvas);
  if (typeof ResizeObserver === 'undefined') return;
  let last = canvas.clientWidth;
  const observer = new ResizeObserver(() => {
    if (canvas.clientWidth === last) return;
    last = canvas.clientWidth;
    if (block.hasAttribute('data-mermaid-scaled-by-hand')) return;
    scaleInto(block, canvas);
  });
  observer.observe(canvas);
  widthWatchers.set(canvas, observer);
}

function scaleInto(block: HTMLElement, canvas: HTMLElement): void {
  const drawn = canvas.querySelector('svg');
  if (drawn === null) return;
  block.removeAttribute('data-mermaid-fit');
  const natural = naturalWidth(drawn);
  const available = canvas.clientWidth - PADDING;
  if (natural <= 0 || available <= 0) return;

  block.toggleAttribute('data-mermaid-fit', fitsTheColumn(natural, available));
  if (natural <= available) {
    block.querySelector('[data-mermaid-scale]')?.remove();
    return;
  }
  const actions = actionsOf(block);
  if (actions.querySelector('[data-mermaid-scale]') === null) {
    actions.prepend(scaleButton(block.ownerDocument));
  }
  const button = actions.querySelector<HTMLButtonElement>('[data-mermaid-scale]');
  if (button !== null) applyScale(button, block.hasAttribute('data-mermaid-fit'));
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

const LABEL_HOSTS = '.node, .cluster, .classGroup, .statediagram-state';

function channels(fill: string): readonly number[] | null {
  const match = /rgba?\(([^)]+)\)/.exec(fill);
  if (match === null) return null;
  const parts = (match[1] ?? '')
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0)
    .map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts;
}

export function inkOn(fill: string): string | null {
  const parts = channels(fill);
  if (parts === null) return null;
  const [red, green, blue, alpha] = parts;
  if (red === undefined || green === undefined || blue === undefined) return null;
  if (alpha !== undefined && alpha < 0.5) return null;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > PALE_FILL ? DARK_INK : LIGHT_INK;
}

export function inkLabels(canvas: HTMLElement): void {
  const view = canvas.ownerDocument.defaultView;
  if (view === null) return;
  for (const host of canvas.querySelectorAll(LABEL_HOSTS)) {
    const shape = host.querySelector('rect, polygon, circle, ellipse, path');
    if (shape === null) continue;
    const ink = inkOn(view.getComputedStyle(shape).fill);
    if (ink === null) continue;
    for (const label of host.querySelectorAll<SVGElement>('text, tspan')) {
      label.style.fill = ink;
    }
  }
}

const PADDING = 32;

let sequence = 0;

function drawInto(block: HTMLElement, svg: string): void {
  const document = block.ownerDocument;
  block.querySelector('[data-mermaid-note]')?.remove();
  let canvas = block.querySelector<HTMLElement>('[data-mermaid-canvas]');
  if (canvas === null) {
    canvas = document.createElement('div');
    canvas.setAttribute('data-mermaid-canvas', '');
    block.prepend(canvas);
  }
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', DIAGRAM_LABEL);
  canvas.innerHTML = svg;
  inkLabels(canvas);
  block.removeAttribute('data-mermaid-scaled-by-hand');
  block.setAttribute('data-mermaid-view', DIAGRAM_VIEW);
  const actions = actionsOf(block);
  if (actions.querySelector('[data-mermaid-expand]') === null) {
    actions.append(expandButton(document));
  }
  if (actions.querySelector('[data-mermaid-view-toggle]') === null) {
    const view = viewButton(document, DIAGRAM_VIEW);
    view.setAttribute('data-mermaid-view-toggle', '');
    actions.append(view);
  }
  scaleInto(block, canvas);
  watchWidth(block, canvas);
}

function failInto(block: HTMLElement, message = DIAGRAM_FAILED): void {
  const canvas = block.querySelector<HTMLElement>('[data-mermaid-canvas]');
  if (canvas !== null) unwatchWidth(canvas);
  canvas?.remove();
  block.querySelector('[data-mermaid-actions]')?.remove();
  block.removeAttribute('data-mermaid-fit');
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
    drawInto(block, svg);
  }
}
