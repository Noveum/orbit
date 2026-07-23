export const SEQUENCE_TIMEOUT_MS = 800;

export interface HotkeyStep {
  readonly key: string;
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface BufferedStep extends HotkeyStep {
  readonly at: number;
}

export interface KeyEventLike {
  readonly key: string;
  readonly code?: string | undefined;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph']);

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  return: 'enter',
};

export function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key.toLowerCase());
}

export function parseBinding(binding: string): HotkeyStep[] {
  return binding
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(parseStep);
}

function parseStep(token: string): HotkeyStep {
  const parts = token.split('+').filter((part) => part.length > 0);
  const last = parts.at(-1) ?? token;
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  return {
    key: normalizeKey(last),
    mod: modifiers.has('mod') || modifiers.has('cmd') || modifiers.has('ctrl'),
    alt: modifiers.has('alt') || modifiers.has('option'),
    shift: modifiers.has('shift'),
  };
}

const LETTER_CODE = /^Key([A-Z])$/;

export function typedKey(event: KeyEventLike): string {
  if (!event.altKey) return event.key;
  const letter = LETTER_CODE.exec(event.code ?? '')?.[1];
  return letter ?? event.key;
}

export function eventToStep(event: KeyEventLike): HotkeyStep {
  return {
    key: normalizeKey(typedKey(event)),
    mod: event.metaKey || event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

export function stepMatches(step: HotkeyStep, actual: HotkeyStep): boolean {
  if (step.key !== actual.key) return false;
  if (step.mod !== actual.mod) return false;
  if (step.alt !== actual.alt) return false;
  return step.shift ? actual.shift : true;
}

export function pruneBuffer(
  buffer: readonly BufferedStep[],
  now: number,
  timeoutMs: number = SEQUENCE_TIMEOUT_MS,
): BufferedStep[] {
  return buffer.filter((entry) => now - entry.at <= timeoutMs);
}

export function bufferMatches(
  steps: readonly HotkeyStep[],
  buffer: readonly BufferedStep[],
): boolean {
  if (steps.length === 0 || steps.length > buffer.length) return false;
  const offset = buffer.length - steps.length;
  return steps.every((step, index) => {
    const actual = buffer[offset + index];
    return actual !== undefined && stepMatches(step, actual);
  });
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  const editable = target.closest('[contenteditable]')?.getAttribute('contenteditable');
  if (editable !== undefined && editable !== null && editable !== 'false') return true;
  return target.getAttribute('role') === 'textbox';
}

export function formatBinding(binding: string): string[] {
  return binding
    .trim()
    .split(/\s+/)
    .flatMap((token) => token.split('+'))
    .filter((part) => part.length > 0);
}
