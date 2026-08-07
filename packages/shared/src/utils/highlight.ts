export const HIGHLIGHT_START = '\uE000';
export const HIGHLIGHT_END = '\uE001';

export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

export function highlightSegments(value: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let buffer = '';
  let inside = false;

  const flush = () => {
    if (buffer.length === 0) return;
    segments.push({ text: buffer, match: inside });
    buffer = '';
  };

  for (const character of value) {
    if (character === HIGHLIGHT_START) {
      flush();
      inside = true;
      continue;
    }
    if (character === HIGHLIGHT_END) {
      flush();
      inside = false;
      continue;
    }
    buffer += character;
  }

  flush();
  return segments;
}

export function stripHighlights(value: string): string {
  return value.split(HIGHLIGHT_START).join('').split(HIGHLIGHT_END).join('');
}
