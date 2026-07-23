import { describe, expect, it } from 'bun:test';
import {
  activatesFocusedControl,
  type BufferedStep,
  bufferMatches,
  eventToStep,
  isEditableTarget,
  isModifierKey,
  type KeyEventLike,
  parseBinding,
  pruneBuffer,
  SEQUENCE_TIMEOUT_MS,
} from './binding.ts';
import { HOTKEY_PRIORITY, type HotkeyEntry, selectMatch } from './registry.ts';

function keyEvent(key: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

function press(buffer: BufferedStep[], key: string, at: number, mods: Partial<KeyEventLike> = {}) {
  buffer.push({ ...eventToStep(keyEvent(key, mods)), at });
  return buffer;
}

function entry(binding: string, overrides: Partial<HotkeyEntry> = {}): HotkeyEntry {
  return {
    id: binding,
    binding,
    label: binding,
    section: 'Navigation',
    scope: 'global',
    priority: HOTKEY_PRIORITY.global,
    enabled: true,
    advertised: true,
    preventDefault: true,
    allowInInput: false,
    run: () => undefined,
    steps: parseBinding(binding),
    ...overrides,
  };
}

describe('parseBinding', () => {
  it('parses a single key', () => {
    expect(parseBinding('?')).toEqual([{ key: '?', mod: false, alt: false, shift: false }]);
  });

  it('parses a modifier combo', () => {
    expect(parseBinding('mod+k')).toEqual([{ key: 'k', mod: true, alt: false, shift: false }]);
  });

  it('parses a sequence into one step per token', () => {
    expect(parseBinding('g i')).toHaveLength(2);
    expect(parseBinding('g i').map((step) => step.key)).toEqual(['g', 'i']);
  });

  it('normalizes aliases', () => {
    expect(parseBinding('esc')[0]?.key).toBe('escape');
    expect(parseBinding('Space')[0]?.key).toBe(' ');
  });
});

describe('isModifierKey', () => {
  it('detects bare modifier presses', () => {
    expect(isModifierKey('Shift')).toBe(true);
    expect(isModifierKey('Meta')).toBe(true);
    expect(isModifierKey('g')).toBe(false);
  });
});

describe('bufferMatches', () => {
  it('matches a single key press', () => {
    const buffer = press([], '[', 0);
    expect(bufferMatches(parseBinding('['), buffer)).toBe(true);
  });

  it('matches a sequence against the buffer tail', () => {
    const buffer = press(press(press([], 'x', 0), 'g', 10), 'i', 20);
    expect(bufferMatches(parseBinding('g i'), buffer)).toBe(true);
  });

  it('rejects a sequence typed in the wrong order', () => {
    const buffer = press(press([], 'i', 0), 'g', 10);
    expect(bufferMatches(parseBinding('g i'), buffer)).toBe(false);
  });

  it('requires the modifier state to match exactly', () => {
    const withMod = press([], 'k', 0, { metaKey: true });
    expect(bufferMatches(parseBinding('mod+k'), withMod)).toBe(true);
    expect(bufferMatches(parseBinding('k'), withMod)).toBe(false);
  });

  it('treats ctrl and cmd as the same mod', () => {
    const withCtrl = press([], 'k', 0, { ctrlKey: true });
    expect(bufferMatches(parseBinding('mod+k'), withCtrl)).toBe(true);
  });
});

describe('pruneBuffer', () => {
  it('drops steps older than the sequence timeout', () => {
    const buffer = press(press([], 'g', 0), 'i', SEQUENCE_TIMEOUT_MS + 1);
    const pruned = pruneBuffer(buffer, SEQUENCE_TIMEOUT_MS + 1);
    expect(pruned.map((step) => step.key)).toEqual(['i']);
    expect(bufferMatches(parseBinding('g i'), pruned)).toBe(false);
  });

  it('keeps steps inside the window', () => {
    const buffer = press(press([], 'g', 0), 'i', SEQUENCE_TIMEOUT_MS - 100);
    const pruned = pruneBuffer(buffer, SEQUENCE_TIMEOUT_MS - 100);
    expect(bufferMatches(parseBinding('g i'), pruned)).toBe(true);
  });
});

describe('isEditableTarget', () => {
  it('ignores null and non-elements', () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it('detects inputs, textareas and selects', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
  });

  it('detects contenteditable regions', () => {
    const node = document.createElement('div');
    node.setAttribute('contenteditable', 'true');
    document.body.append(node);
    expect(isEditableTarget(node)).toBe(true);
    node.remove();
  });

  it('detects role=textbox', () => {
    const node = document.createElement('div');
    node.setAttribute('role', 'textbox');
    expect(isEditableTarget(node)).toBe(true);
  });

  it('leaves plain elements alone', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });
});

describe('selectMatch', () => {
  const entries = [entry('g'), entry('g i'), entry('mod+k', { allowInInput: true })];

  it('prefers the longest matching binding', () => {
    const buffer = press(press([], 'g', 0), 'i', 10);
    expect(selectMatch(entries, buffer, false)?.binding).toBe('g i');
  });

  it('skips bindings that are not allowed inside inputs', () => {
    const buffer = press([], 'g', 0);
    expect(selectMatch(entries, buffer, true)).toBeNull();
  });

  it('still fires bindings that opt into inputs', () => {
    const buffer = press([], 'k', 0, { metaKey: true });
    expect(selectMatch(entries, buffer, true)?.binding).toBe('mod+k');
  });

  it('skips disabled bindings', () => {
    const buffer = press([], 'g', 0);
    expect(selectMatch([entry('g', { enabled: false })], buffer, false)).toBeNull();
  });

  it('prefers the binding that asks for shift when shift is held', () => {
    const both = [entry('f'), entry('shift+f')];
    const shifted = press([], 'F', 0, { shiftKey: true });
    expect(selectMatch(both, shifted, false)?.binding).toBe('shift+f');
    expect(selectMatch(both, press([], 'f', 0), false)?.binding).toBe('f');
    expect(selectMatch(both.toReversed(), shifted, false)?.binding).toBe('shift+f');
  });

  it('reads the physical key when alt rewrites the character', () => {
    const step = eventToStep(keyEvent('Ï', { altKey: true, shiftKey: true, code: 'KeyF' }));
    expect(step.key).toBe('f');
    expect(bufferMatches(parseBinding('alt+shift+f'), [{ ...step, at: 0 }])).toBe(true);
  });
});

describe('selectMatch priority', () => {
  const newIssue = entry('c', { id: 'issue', label: 'Create issue' });
  const newDoc = entry('c', {
    id: 'doc',
    label: 'New doc',
    scope: 'docs',
    priority: HOTKEY_PRIORITY.surface,
  });

  it('resolves to the higher priority binding whatever the registration order', () => {
    const buffer = press([], 'c', 0);
    expect(selectMatch([newIssue, newDoc], buffer, false)?.id).toBe('doc');
    expect(selectMatch([newDoc, newIssue], buffer, false)?.id).toBe('doc');
  });

  it('falls back to the global binding when the surface binding is disabled', () => {
    const readOnlyDoc = { ...newDoc, enabled: false };
    const buffer = press([], 'c', 0);
    expect(selectMatch([newIssue, readOnlyDoc], buffer, false)?.id).toBe('issue');
    expect(selectMatch([readOnlyDoc, newIssue], buffer, false)?.id).toBe('issue');
  });

  it('gives the innermost layer the escape key while it is open', () => {
    const clearSelection = entry('escape', { id: 'selection', scope: 'issues' });
    const closeMenu = entry('escape', {
      id: 'menu',
      scope: 'filters',
      priority: HOTKEY_PRIORITY.layer,
    });
    const buffer = press([], 'Escape', 0);
    expect(selectMatch([clearSelection, closeMenu], buffer, false)?.id).toBe('menu');
    expect(selectMatch([closeMenu, clearSelection], buffer, false)?.id).toBe('menu');
    expect(selectMatch([clearSelection], buffer, false)?.id).toBe('selection');
  });
});

describe('activatesFocusedControl', () => {
  function node(tag: string, attributes: Record<string, string> = {}): Element {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  it('keeps enter and space for every focusable control', () => {
    const controls = [
      node('button'),
      node('a', { href: '/issue/ENG-1' }),
      node('summary'),
      node('div', { role: 'button' }),
      node('div', { role: 'menuitem' }),
      node('div', { role: 'option' }),
    ];
    for (const control of controls) {
      expect(activatesFocusedControl(keyEvent('Enter'), control)).toBe(true);
      expect(activatesFocusedControl(keyEvent(' '), control)).toBe(true);
    }
  });

  it('looks past the label a control renders inside itself', () => {
    const button = node('button');
    const label = document.createElement('span');
    button.append(label);
    expect(activatesFocusedControl(keyEvent('Enter'), label)).toBe(true);
  });

  it('leaves plain elements and anchors without a target to the registry', () => {
    expect(activatesFocusedControl(keyEvent('Enter'), node('a'))).toBe(false);
    expect(activatesFocusedControl(keyEvent('Enter'), node('div'))).toBe(false);
    expect(activatesFocusedControl(keyEvent('Enter'), null)).toBe(false);
  });

  it('guards only unmodified activation keys', () => {
    const button = node('button');
    expect(activatesFocusedControl(keyEvent('j'), button)).toBe(false);
    expect(activatesFocusedControl(keyEvent('Escape'), button)).toBe(false);
    expect(activatesFocusedControl(keyEvent('Enter', { metaKey: true }), button)).toBe(false);
    expect(activatesFocusedControl(keyEvent(' ', { altKey: true }), button)).toBe(false);
  });
});
