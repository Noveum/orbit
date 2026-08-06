import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const DOC_ANCHOR_ATTRIBUTE = 'data-doc-comment-anchor';
export const DOC_ANCHOR_CLASS = 'orbit-doc-anchor';
export const DOC_ANCHOR_ACTIVE_CLASS = 'orbit-doc-anchor-active';

export interface DocAnchorDecoration {
  readonly commentId: string;
  readonly from: number;
  readonly to: number;
  readonly focused: boolean;
}

export interface DocAnchorDecorationRef {
  current: readonly DocAnchorDecoration[];
}

export const docAnchorPluginKey = new PluginKey('orbitDocCommentAnchors');

function withinDoc(doc: ProseMirrorNode, range: DocAnchorDecoration): boolean {
  return range.from >= 0 && range.to > range.from && range.to <= doc.content.size;
}

function decorationFor(range: DocAnchorDecoration): Decoration {
  return Decoration.inline(range.from, range.to, {
    class: range.focused ? `${DOC_ANCHOR_CLASS} ${DOC_ANCHOR_ACTIVE_CLASS}` : DOC_ANCHOR_CLASS,
    [DOC_ANCHOR_ATTRIBUTE]: range.commentId,
  });
}

export function docAnchorPlugin(ranges: DocAnchorDecorationRef): Plugin {
  return new Plugin({
    key: docAnchorPluginKey,
    props: {
      decorations(state) {
        const drawable = ranges.current.filter((range) => withinDoc(state.doc, range));
        if (drawable.length === 0) return DecorationSet.empty;
        return DecorationSet.create(state.doc, drawable.map(decorationFor));
      },
    },
  });
}
