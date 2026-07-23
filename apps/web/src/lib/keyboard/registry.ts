import { type BufferedStep, bufferMatches, type HotkeyStep, parseBinding } from './binding.ts';

export type HotkeySection = 'Navigation' | 'General' | 'Issues' | 'View';

export interface HotkeyEntryInput {
  readonly id: string;
  readonly binding: string;
  readonly label: string;
  readonly section: HotkeySection;
  readonly enabled: boolean;
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

function beats(candidate: HotkeyEntry, current: HotkeyEntry): boolean {
  if (candidate.steps.length !== current.steps.length) {
    return candidate.steps.length > current.steps.length;
  }
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
    this.entries.set(input.id, { ...input, steps: parseBinding(input.binding) });
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
