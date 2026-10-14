// Whitespace of the diff comparison key. Explicitly defined (the Unicode `White_Space` property, 25 code points) and
// implemented identically in Rust (`src-tauri/src/diff/whitespace.rs`, same as `char::is_whitespace`). JS `\s` and
// `String.trim()` are NOT used: they also treat U+FEFF as whitespace.
//
// U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
// Not whitespace: U+200B (zero width space), U+2060 (word joiner), U+FEFF (BOM / zero width no-break space).
// LF/CR never occur inside a line (shared line model); VT, FF, NEL, U+2028 and U+2029 can.

const WHITESPACE_RUN = /[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;
const ONLY_WHITESPACE = /^[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*$/;

/** True for an empty line or a line that only consists of whitespace. */
export const isBlankLine = (line: string): boolean => ONLY_WHITESPACE.test(line);

/**
 * Comparison key of a line. With `ignoreWhitespace`, leading and trailing whitespace is removed and every inner
 * whitespace run becomes one space (U+0020). Only the key is normalized; the displayed text stays unchanged.
 */
export function comparisonKey(line: string, ignoreWhitespace: boolean): string {
  if (!ignoreWhitespace) return line;
  let key = line.replace(WHITESPACE_RUN, ' ');
  if (key.startsWith(' ')) key = key.slice(1);
  if (key.endsWith(' ')) key = key.slice(0, -1);
  return key;
}
