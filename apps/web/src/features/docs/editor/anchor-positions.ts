import { buildDocAnchor, locateDocAnchor } from '@orbit/shared/utils';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface DocTextSpan {
  readonly pos: number;
  readonly offset: number;
  readonly length: number;
}

export interface DocText {
  readonly text: string;
  readonly spans: readonly DocTextSpan[];
}

export interface DocTextRange {
  readonly from: number;
  readonly to: number;
}

export function docTextOf(doc: ProseMirrorNode): DocText {
  const spans: DocTextSpan[] = [];
  let text = '';

  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text ?? '';
      if (value.length === 0) return false;
      spans.push({ pos, offset: text.length, length: value.length });
      text += value;
      return false;
    }
    if (node.isTextblock && text.length > 0) text += '\n';
    return true;
  });

  return { text, spans };
}

export function offsetOfPos(docText: DocText, pos: number): number {
  let end = 0;
  for (const span of docText.spans) {
    if (pos < span.pos) return span.offset;
    if (pos <= span.pos + span.length) return span.offset + (pos - span.pos);
    end = span.offset + span.length;
  }
  return end;
}

export function posOfOffset(docText: DocText, offset: number): number | null {
  for (const span of docText.spans) {
    if (offset < span.offset) return span.pos;
    if (offset <= span.offset + span.length) return span.pos + (offset - span.offset);
  }
  const last = docText.spans.at(-1);
  return last === undefined ? null : last.pos + last.length;
}

export function anchorFromSelection(
  docText: DocText,
  from: number,
  to: number,
): DocCommentAnchor | null {
  const start = offsetOfPos(docText, Math.min(from, to));
  const end = offsetOfPos(docText, Math.max(from, to));
  const anchor = buildDocAnchor(docText.text, start, end);
  return anchor.quote.trim().length === 0 ? null : anchor;
}

export function anchorRangeIn(docText: DocText, anchor: DocCommentAnchor): DocTextRange | null {
  const match = locateDocAnchor(docText.text, anchor);
  if (match === null) return null;
  const from = posOfOffset(docText, match.start);
  const to = posOfOffset(docText, match.end);
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}
