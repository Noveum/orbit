import type { DocCommentAnchor } from '../validators/comment.ts';
import { DOC_ANCHOR_CONTEXT_LIMIT, DOC_ANCHOR_QUOTE_LIMIT } from '../validators/comment.ts';

export { DOC_ANCHOR_CONTEXT_LIMIT, DOC_ANCHOR_QUOTE_LIMIT };

const MAX_ANCHOR_CANDIDATES = 512;

export interface DocAnchorMatch {
  readonly start: number;
  readonly end: number;
}

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

function splitsACharacter(text: string, at: number): boolean {
  const here = text.charCodeAt(at);
  const before = text.charCodeAt(at - 1);
  return (
    here >= LOW_SURROGATE_FIRST &&
    here <= LOW_SURROGATE_LAST &&
    before >= HIGH_SURROGATE_FIRST &&
    before <= HIGH_SURROGATE_LAST
  );
}

function opensOn(text: string, at: number): number {
  return splitsACharacter(text, at) ? at + 1 : at;
}

function closesOn(text: string, at: number): number {
  return splitsACharacter(text, at) ? at - 1 : at;
}

export function buildDocAnchor(text: string, start: number, end: number): DocCommentAnchor {
  const from = opensOn(text, Math.max(0, Math.min(start, text.length)));
  const selected = Math.max(from, Math.min(end, text.length));
  const to = closesOn(text, Math.min(selected, from + DOC_ANCHOR_QUOTE_LIMIT));
  return {
    quote: text.slice(from, to),
    prefix: text.slice(opensOn(text, Math.max(0, from - DOC_ANCHOR_CONTEXT_LIMIT)), from),
    suffix: text.slice(to, closesOn(text, to + DOC_ANCHOR_CONTEXT_LIMIT)),
    start: from,
  };
}

function takesAhead(ahead: number, behind: number, start: number): boolean {
  if (behind === -1) return true;
  if (ahead === -1) return false;
  return ahead - start <= start - behind;
}

function occurrencesNearest(text: string, quote: string, start: number): number[] {
  const found: number[] = [];
  let ahead = text.indexOf(quote, Math.max(0, start));
  let behind = start <= 0 ? -1 : text.lastIndexOf(quote, start - 1);

  while (found.length < MAX_ANCHOR_CANDIDATES && (ahead !== -1 || behind !== -1)) {
    if (takesAhead(ahead, behind, start)) {
      found.push(ahead);
      ahead = text.indexOf(quote, ahead + 1);
    } else {
      found.push(behind);
      behind = behind === 0 ? -1 : text.lastIndexOf(quote, behind - 1);
    }
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

function tooAmbiguous(
  best: AnchorCandidate,
  anchor: DocCommentAnchor,
  candidateCount: number,
): boolean {
  if (candidateCount < MAX_ANCHOR_CANDIDATES) return false;
  if (anchor.prefix.length === 0 && anchor.suffix.length === 0) return false;
  return best.context === 0;
}

export function locateDocAnchor(text: string, anchor: DocCommentAnchor): DocAnchorMatch | null {
  if (anchor.quote.length === 0) return null;

  const candidates = occurrencesNearest(text, anchor.quote, anchor.start);
  let best: AnchorCandidate | null = null;
  for (const at of candidates) {
    const candidate: AnchorCandidate = {
      at,
      context: contextScoreAt(text, anchor, at),
      drift: Math.abs(at - anchor.start),
    };
    if (beatsBest(candidate, best)) best = candidate;
  }

  if (best === null) return null;
  if (tooAmbiguous(best, anchor, candidates.length)) return null;
  return { start: best.at, end: best.at + anchor.quote.length };
}

export function isDocAnchorOrphaned(text: string, anchor: DocCommentAnchor): boolean {
  return locateDocAnchor(text, anchor) === null;
}
