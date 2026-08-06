export interface HighlightPart {
  readonly text: string;
  readonly match: boolean;
  readonly start: number;
}

export function splitOnTerm(text: string, term: string): HighlightPart[] {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0 || text.length === 0) return [{ text, match: false, start: 0 }];

  const haystack = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;

  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) parts.push({ text: text.slice(cursor, at), match: false, start: cursor });
    parts.push({ text: text.slice(at, at + needle.length), match: true, start: at });
    cursor = at + needle.length;
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false, start: cursor });
  return parts.length === 0 ? [{ text, match: false, start: 0 }] : parts;
}

export function MatchedText({ text, term }: { readonly text: string; readonly term: string }) {
  return (
    <>
      {splitOnTerm(text, term).map((part) =>
        part.match ? (
          <mark
            key={part.start}
            data-match="true"
            className="bg-transparent font-medium text-accent"
          >
            {part.text}
          </mark>
        ) : (
          <span key={part.start}>{part.text}</span>
        ),
      )}
    </>
  );
}
