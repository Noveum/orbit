import type { DocCommentAnchor } from '../validators/comment.ts';
import { DOC_ANCHOR_CONTEXT_LIMIT } from '../validators/comment.ts';

export { DOC_ANCHOR_CONTEXT_LIMIT };

const MAX_ANCHOR_CANDIDATES = 512;

export interface DocAnchorMatch {
  readonly start: number;
  readonly end: number;
}

export function buildDocAnchor(text: string, start: number, end: number): DocCommentAnchor {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - DOC_ANCHOR_CONTEXT_LIMIT), from),
    suffix: text.slice(to, to + DOC_ANCHOR_CONTEXT_LIMIT),
    start: from,
  };
}

function occurrencesOf(text: string, quote: string): number[] {
  const found: number[] = [];
  let at = text.indexOf(quote);
  while (at !== -1 && found.length < MAX_ANCHOR_CANDIDATES) {
    found.push(at);
    at = text.indexOf(quote, at + 1);
  }
  return found;
}

function sharedTailLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let shared = 0;
  while (shared < limit && left.at(-1 - shared) === right.at(-1 - shared)) shared += 1;
  return shared;
}

function sharedHeadLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let shared = 0;
  while (shared < limit && left[shared] === right[shared]) shared += 1;
  return shared;
}

function contextScoreAt(text: string, anchor: DocCommentAnchor, at: number): number {
  const end = at + anchor.quote.length;
  const before = text.slice(Math.max(0, at - anchor.prefix.length), at);
  const after = text.slice(end, end + anchor.suffix.length);
  return sharedTailLength(before, anchor.prefix) + sharedHeadLength(after, anchor.suffix);
}

interface AnchorCandidate {
  readonly at: number;
  readonly context: number;
  readonly drift: number;
}

function beatsBest(candidate: AnchorCandidate, best: AnchorCandidate | null): boolean {
  if (best === null) return true;
  if (candidate.context !== best.context) return candidate.context > best.context;
  return candidate.drift < best.drift;
}

export function locateDocAnchor(text: string, anchor: DocCommentAnchor): DocAnchorMatch | null {
  if (anchor.quote.length === 0) return null;

  let best: AnchorCandidate | null = null;
  for (const at of occurrencesOf(text, anchor.quote)) {
    const candidate: AnchorCandidate = {
      at,
      context: contextScoreAt(text, anchor, at),
      drift: Math.abs(at - anchor.start),
    };
    if (beatsBest(candidate, best)) best = candidate;
  }

  if (best === null) return null;
  return { start: best.at, end: best.at + anchor.quote.length };
}

export function isDocAnchorOrphaned(text: string, anchor: DocCommentAnchor): boolean {
  return locateDocAnchor(text, anchor) === null;
}
