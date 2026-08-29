import { type BufferedStep, bufferMatches, type HotkeyStep, parseBinding } from './binding.ts';

export type HotkeySection = 'Navigation' | 'General' | 'Issues' | 'View';

export type HotkeyScope = 'global' | 'issues' | 'docs' | 'inbox' | 'filters';

export const HOTKEY_PRIORITY = {
  global: 0,
  surface: 1,
  layer: 2,
} as const;

export interface HotkeyEntryInput {
  readonly id: string;
  readonly binding: string;
  readonly label: string;
  readonly section: HotkeySection;
  readonly scope: HotkeyScope;
  readonly priority: number;
  readonly enabled: boolean;
  readonly advertised: boolean;
  readonly preventDefault: boolean;
  readonly allowInInput: boolean;
  readonly run: (event: KeyboardEvent) => void;
}

export interface HotkeyEntry extends HotkeyEntryInput {
  readonly steps: readonly HotkeyStep[];
}

function shiftSpecificity(entry: HotkeyEntry): number {
  return entry.steps.reduce((total, step) => total + (step.shift ? 1 : 0), 0);
}

function stepsCollide(a: readonly HotkeyStep[], b: readonly HotkeyStep[]): boolean {
  if (a.length !== b.length) return false;
  let shiftA = 0;
  let shiftB = 0;
  for (let i = 0; i < a.length; i++) {
    const stepA = a[i];
    const stepB = b[i];
    if (!(stepA && stepB)) return false;
    if (stepA.key !== stepB.key || stepA.mod !== stepB.mod || stepA.alt !== stepB.alt) {
      return false;
    }
    if (stepA.shift) shiftA++;
    if (stepB.shift) shiftB++;
  }
  return shiftA === shiftB;
}

function beats(candidate: HotkeyEntry, current: HotkeyEntry): boolean {
  if (candidate.steps.length !== current.steps.length) {
    return candidate.steps.length > current.steps.length;
  }
  if (candidate.priority !== current.priority) return candidate.priority > current.priority;
  return shiftSpecificity(candidate) > shiftSpecificity(current);
}

export function selectMatch(
  entries: readonly HotkeyEntry[],
  buffer: readonly BufferedStep[],
  editableTarget: boolean,
): HotkeyEntry | null {
  let best: HotkeyEntry | null = null;
  for (const entry of entries) {
    if (!entry.enabled) continue;
    if (editableTarget && !entry.allowInInput) continue;
    if (!bufferMatches(entry.steps, buffer)) continue;
    if (best === null || beats(entry, best)) best = entry;
  }
  return best;
}

export class HotkeyRegistry {
  private readonly entries = new Map<string, HotkeyEntry>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly HotkeyEntry[] = [];

  register(input: HotkeyEntryInput): () => void {
    const steps = parseBinding(input.binding);

    if (process.env.NODE_ENV !== 'production' && input.advertised) {
      for (const existing of this.entries.values()) {
        if (existing.id === input.id) continue;
        if (
          existing.advertised &&
          existing.priority === input.priority &&
          stepsCollide(existing.steps, steps)
        ) {
          console.warn(
            `Duplicate hotkey collision: "${input.binding}" is advertised by both "${existing.id}" and "${input.id}" at priority ${input.priority}. This will cause silent resolution.`,
          );
        }
      }
    }
    this.entries.set(input.id, { ...input, steps });
    this.publish();
    return () => {
      this.entries.delete(input.id);
      this.publish();
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly HotkeyEntry[] => this.snapshot;

  private publish(): void {
    this.snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener();
  }
}
