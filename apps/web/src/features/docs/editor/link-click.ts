import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const OPENABLE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function openableHref(href: string | null, base: string): string | null {
  if (href === null || href.trim().length === 0) return null;
  try {
    const url = new URL(href, base);
    return OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export const LinkClick = Extension.create({
  name: 'orbitLinkClick',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('orbitLinkClick'),
        props: {
          handleClick: (view, _pos, event) => {
            if (!view.editable || event.button !== 0) return false;
            const target = event.target;
            if (!(target instanceof Element)) return false;
            const anchor = target.closest('a');
            if (anchor === null || !view.dom.contains(anchor)) return false;
            const href = openableHref(anchor.getAttribute('href'), view.dom.baseURI);
            if (href === null) return false;
            window.open(href, '_blank', 'noopener,noreferrer');
            return true;
          },
        },
      }),
    ];
  },
});
