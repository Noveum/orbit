import { expect, test } from 'bun:test';
import {
  HOTKEY_PRIORITY,
  type HotkeyEntryInput,
  HotkeyRegistry,
} from '../../../src/lib/keyboard/registry.ts';

function createDummyEntry(id: string, binding: string, priority: number): HotkeyEntryInput {
  return {
    id,
    binding,
    label: 'Test Command',
    section: 'General',
    scope: 'global',
    priority,
    enabled: true,
    advertised: true,
    preventDefault: true,
    allowInInput: false,
    run: () => true,
  };
}

test('HotkeyRegistry warns on duplicate bindings with the same priority', () => {
  const registry = new HotkeyRegistry();

  let warningMessage = '';
  const originalWarn = console.warn;

  try {
    console.warn = (msg: string) => {
      warningMessage = msg;
    };
    registry.register(createDummyEntry('cmd:one', 'shift+d', HOTKEY_PRIORITY.global));
    registry.register(createDummyEntry('cmd:two', 'shift+d', HOTKEY_PRIORITY.global));
  } finally {
    console.warn = originalWarn;
  }

  expect(warningMessage).toContain('Duplicate hotkey collision');
  expect(warningMessage).toContain('shift+d');
  expect(warningMessage).toContain('cmd:one');
  expect(warningMessage).toContain('cmd:two');
});

test('HotkeyRegistry does not warn if priorities are different', () => {
  const registry = new HotkeyRegistry();

  let warned = false;
  const originalWarn = console.warn;

  try {
    console.warn = () => {
      warned = true;
    };
    registry.register(createDummyEntry('cmd:global', 'shift+d', HOTKEY_PRIORITY.global));
    registry.register(createDummyEntry('cmd:surface', 'shift+d', HOTKEY_PRIORITY.surface));
  } finally {
    console.warn = originalWarn;
  }

  expect(warned).toBe(false);
});

test('HotkeyRegistry warns on colliding shift specificity with different shift locations', () => {
  const registry = new HotkeyRegistry();

  let warningMessage = '';
  const originalWarn = console.warn;

  try {
    console.warn = (msg: string) => {
      warningMessage = msg;
    };
    registry.register(createDummyEntry('cmd:one', 'shift+a b', HOTKEY_PRIORITY.global));
    registry.register(createDummyEntry('cmd:two', 'a shift+b', HOTKEY_PRIORITY.global));
  } finally {
    console.warn = originalWarn;
  }

  expect(warningMessage).toContain('Duplicate hotkey collision');
});
