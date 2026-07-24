import { Extension, mergeAttributes, Node } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { calloutToneOf } from './markdown.ts';

export const MENU_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: 'note',
        parseHTML: (element: HTMLElement): string => element.getAttribute('data-callout') ?? 'note',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => ({
          'data-callout': typeof attributes['tone'] === 'string' ? attributes['tone'] : 'note',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'blockquote[data-callout]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['blockquote', mergeAttributes(HTMLAttributes, { class: 'orbit-callout' }), 0];
  },
});

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'summary' }];
  },
  renderHTML() {
    return ['summary', { class: 'orbit-toggle-summary' }, 0];
  },
});

export const ToggleBlock = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'toggleSummary block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'details' }];
  },
  renderHTML() {
    return ['details', { class: 'orbit-toggle', open: 'true' }, 0];
  },
});

export interface MenuKeyHandlerRef {
  current: (key: MenuKey) => boolean;
}

export const MenuKeymap = Extension.create<{ handler: MenuKeyHandlerRef | null }>({
  name: 'orbitMenuKeymap',
  addOptions() {
    return { handler: null };
  },
  addKeyboardShortcuts() {
    const bindings: Record<string, () => boolean> = {};
    for (const key of MENU_KEYS) {
      bindings[key] = () => this.options.handler?.current(key) ?? false;
    }
    return bindings;
  },
});

const lowlight = createLowlight(common);

export function editorExtensions(handler: MenuKeyHandlerRef, placeholder = '') {
  return [
    Placeholder.configure({ placeholder, emptyEditorClass: 'orbit-editor-empty' }),
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true },
      heading: { levels: [1, 2, 3, 4] },
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'ts' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ allowBase64: false }),
    Callout,
    ToggleSummary,
    ToggleBlock,
    MenuKeymap.configure({ handler }),
  ];
}

function markCallout(root: ParentNode): void {
  for (const quote of root.querySelectorAll('blockquote')) {
    const lead = quote.firstElementChild;
    if (lead === null || lead.tagName !== 'P') continue;
    const strong = lead.firstElementChild;
    if (strong === null || strong.tagName !== 'STRONG') continue;
    const tone = calloutToneOf(strong.textContent ?? '');
    if (tone === null) continue;
    quote.setAttribute('data-callout', tone);
    strong.remove();
    if ((lead.textContent ?? '').trim().length === 0) lead.remove();
  }
}

function markTaskLists(root: ParentNode): void {
  for (const list of root.querySelectorAll('ul')) {
    const items = [...list.children].filter((child) => child.tagName === 'LI');
    const boxes = items.map((item) => item.querySelector('input[type=checkbox]'));
    if (items.length === 0 || boxes.some((box) => box === null)) continue;

    list.setAttribute('data-type', 'taskList');
    items.forEach((item, index) => {
      const box = boxes[index];
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', box?.hasAttribute('checked') === true ? 'true' : 'false');
      box?.remove();
      if (item.firstElementChild?.tagName !== 'P') {
        const paragraph = item.ownerDocument.createElement('p');
        paragraph.append(...item.childNodes);
        item.append(paragraph);
      }
    });
  }
}

export function toEditorHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  markCallout(template.content);
  markTaskLists(template.content);
  return template.innerHTML;
}
