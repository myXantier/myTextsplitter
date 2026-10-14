// Shared line model of the text processing (Paket 6). Same rules as the Rust engine (src-tauri/src/line_endings.rs),
// shared fixtures: tests/fixtures/line-endings-cases.json. Kept free of imports so it can be unit-tested with plain Node.
//
// - Line breaks are LF, CRLF and CR, detected from the text itself (never from the operating system).
// - A text is a list of data lines. A terminator after the last line is the trailing newline, not an extra empty line:
//   'A\nB' and 'A\nB\n' both have 2 lines, 'A\nB\n\n' has 3 (the last one empty). An empty text has no lines.
// - Terminators are never part of a line's content (regexes see the same line text in both engines).
// - Newly generated result strings use one line ending: the most frequent one of the input, on a tie the one that occurs
//   first, LF if the input has no line break. The input text itself is never changed.

export type LineEnding = '\n' | '\r\n' | '\r';

/** How result lines are joined into a text. */
export interface LineFormat {
  lineEnding: LineEnding;
  /** The input ends with a line break: a non-empty result ends with one too. */
  trailingNewline: boolean;
}

export interface TextLines extends LineFormat {
  /** Content of the data lines, without terminators. Empty lines are `''`. */
  lines: string[];
}

export const DEFAULT_LINE_FORMAT: LineFormat = { lineEnding: '\n', trailingNewline: false };

const LF = 10;
const CR = 13;

/** Splits a text into its data lines and detects its line format. */
export function splitLines(text: string): TextLines {
  const lines: string[] = [];
  // Counts and first position per line ending, in the order LF, CRLF, CR
  const counts = [0, 0, 0];
  const first = [-1, -1, -1];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code !== LF && code !== CR) continue;

    const kind = code === LF ? 0 : text.charCodeAt(i + 1) === LF ? 1 : 2;
    if (first[kind] < 0) first[kind] = i;
    counts[kind]++;
    lines.push(text.slice(start, i));
    if (kind === 1) i++;
    start = i + 1;
  }

  // A text that ends with a terminator has no further line; otherwise the rest is the last line
  const trailingNewline = start > 0 && start === text.length;
  if (start < text.length) lines.push(text.slice(start));

  return { lines, lineEnding: dominantLineEnding(counts, first), trailingNewline };
}

const LINE_ENDINGS: readonly LineEnding[] = ['\n', '\r\n', '\r'];

function dominantLineEnding(counts: number[], first: number[]): LineEnding {
  let best = -1;
  for (let kind = 0; kind < LINE_ENDINGS.length; kind++) {
    if (!counts[kind]) continue;
    if (best < 0 || counts[kind] > counts[best] || (counts[kind] === counts[best] && first[kind] < first[best])) best = kind;
  }
  return best < 0 ? '\n' : LINE_ENDINGS[best];
}

/** Line format of a text (line ending + trailing newline) without keeping its lines. */
export function lineFormatOf(text: string): LineFormat {
  const { lineEnding, trailingNewline } = splitLines(text);
  return { lineEnding, trailingNewline };
}

/**
 * Joins result lines with the line ending of `format`; a trailing newline is added if the input had one.
 * No lines give `''` (all data lines removed). One empty line without trailing newline is also `''`: the text
 * representation cannot tell it apart from an empty result.
 */
export function joinLines(lines: readonly string[], format: LineFormat): string {
  if (!lines.length) return '';
  const text = lines.join(format.lineEnding);
  return format.trailingNewline ? text + format.lineEnding : text;
}
