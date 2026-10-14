// Tokenizer of the optional word diff (Paket 7, B2). Same table and rules as Rust (`src-tauri/src/diff/tokenize.rs`);
// shared fixtures `tests/fixtures/intraline-cases.json` (section `tokens`). It works on code points with an explicit
// classification table: no `\w`, `\s` or Unicode properties of the JS/Rust engines (their definitions and Unicode
// versions differ).
//
// Token kinds:
// - whitespace run: maximal run of whitespace (the diff whitespace set, `whitespace.ts`);
// - word: maximal run of "word" code points (letters of every script, digits, `_`, everything not listed below);
//   letters and digits are not split (`v2`, `Preis100` are one token; `3.14` is `3`, `.`, `14`);
// - single: every punctuation character, CJK ideograph, kana, Hangul syllable, emoji / pictograph / symbol is its own
//   token; punctuation (the `Punctuation` rows of the table) is marked separately for the line similarity;
// - extend: combining marks, variation selectors, ZWJ, emoji modifiers, tag characters and invisible format
//   characters are appended to the previous token; the code point after a ZWJ is appended as well, two regional
//   indicators form one flag.
//
// Simplification (documented): this is no full Unicode grapheme segmentation (UAX #29). The table covers the common
// combining blocks and emoji sequences; marks outside these blocks start or continue a word like a letter.

import { isWhitespaceCodePoint } from './whitespace';

// Token kinds of a code point (plain constants: Node runs the sources with type stripping only)
const Kind = { Whitespace: 0, Word: 1, Single: 2, Extend: 3, RegionalIndicator: 4, Punctuation: 5 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/** [first, last, kind], checked in this order (first match wins); everything else is a word code point. */
const TABLE: readonly (readonly [number, number, Kind])[] = [
  // extend
  [0x0300, 0x036f, Kind.Extend], // combining diacritical marks
  [0x1ab0, 0x1aff, Kind.Extend],
  [0x1dc0, 0x1dff, Kind.Extend],
  [0x200b, 0x200f, Kind.Extend], // zero width space/non-joiner/joiner, LRM, RLM
  [0x2060, 0x2064, Kind.Extend], // word joiner and invisible operators
  [0x20d0, 0x20ff, Kind.Extend], // combining marks for symbols (keycap)
  [0xfe00, 0xfe0f, Kind.Extend], // variation selectors
  [0xfe20, 0xfe2f, Kind.Extend], // combining half marks
  [0xfeff, 0xfeff, Kind.Extend], // zero width no-break space / BOM
  [0x1f3fb, 0x1f3ff, Kind.Extend], // emoji skin tone modifiers
  [0xe0020, 0xe007f, Kind.Extend], // tag characters (subdivision flags)
  [0xe0100, 0xe01ef, Kind.Extend], // variation selectors supplement
  [0x1f1e6, 0x1f1ff, Kind.RegionalIndicator],
  // single: ASCII punctuation and symbols (not `_`)
  [0x21, 0x2f, Kind.Punctuation],
  [0x3a, 0x40, Kind.Punctuation],
  [0x5b, 0x5e, Kind.Punctuation],
  [0x60, 0x60, Kind.Punctuation],
  [0x7b, 0x7e, Kind.Punctuation],
  // Latin-1 punctuation and symbols (not ª µ º)
  [0xa1, 0xa9, Kind.Punctuation],
  [0xab, 0xb4, Kind.Punctuation],
  [0xb6, 0xb9, Kind.Punctuation],
  [0xbb, 0xbf, Kind.Punctuation],
  [0xd7, 0xd7, Kind.Punctuation],
  [0xf7, 0xf7, Kind.Punctuation],
  // general punctuation (dashes, quotes, ellipsis, ...), arrows, technical symbols
  [0x2010, 0x2027, Kind.Punctuation],
  [0x2030, 0x205e, Kind.Punctuation],
  [0x2190, 0x21ff, Kind.Single],
  [0x2300, 0x23ff, Kind.Single],
  // symbols and dingbats (also emoji such as U+2600..U+27BF)
  [0x2600, 0x27bf, Kind.Single],
  [0x2b00, 0x2bff, Kind.Single],
  // CJK: radicals, punctuation, kana, bopomofo, ideographs, Hangul syllables, compatibility ideographs
  [0x2e80, 0x2fdf, Kind.Single],
  [0x3001, 0x303f, Kind.Punctuation],
  [0x3040, 0x30ff, Kind.Single],
  [0x3100, 0x312f, Kind.Single],
  [0x3400, 0x4dbf, Kind.Single],
  [0x4e00, 0x9fff, Kind.Single],
  [0xac00, 0xd7af, Kind.Single],
  [0xf900, 0xfaff, Kind.Single],
  // fullwidth punctuation
  [0xff01, 0xff0f, Kind.Punctuation],
  [0xff1a, 0xff20, Kind.Punctuation],
  [0xff3b, 0xff40, Kind.Punctuation],
  [0xff5b, 0xff65, Kind.Punctuation],
  // emoji and pictographs
  [0x1f000, 0x1faff, Kind.Single],
  // CJK extension ideographs
  [0x20000, 0x3134f, Kind.Single],
];

function kindOf(cp: number): Kind {
  if (isWhitespaceCodePoint(cp)) return Kind.Whitespace;
  for (const [first, last, kind] of TABLE) if (cp >= first && cp <= last) return kind;
  return Kind.Word;
}

const ZWJ = 0x200d;

/** Splits a line into tokens; their concatenation is exactly the line. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let lastKind: Kind | null = null;
  let joinNext = false;
  let openFlag = false;
  for (const ch of line) {
    const cp = ch.codePointAt(0)!;
    const kind = kindOf(cp);
    const last = tokens.length - 1;
    if (last >= 0 && (kind === Kind.Extend || joinNext || (kind === Kind.RegionalIndicator && openFlag))) {
      tokens[last] += ch;
      joinNext = cp === ZWJ;
      openFlag = false;
      continue;
    }
    joinNext = false;
    if (last >= 0 && kind === lastKind && (kind === Kind.Whitespace || kind === Kind.Word)) {
      tokens[last] += ch;
      continue;
    }
    tokens.push(ch);
    lastKind = kind;
    joinNext = cp === ZWJ;
    openFlag = kind === Kind.RegionalIndicator;
  }
  return tokens;
}

/**
 * Class of a token for the line similarity of the word diff: `whitespace` (only whitespace), `punctuation` (starts with
 * a punctuation code point of the table, attached marks included) or `significant` (words, numbers, CJK, emoji,
 * symbols, and a leading combining mark).
 */
export function tokenClass(token: string): 'whitespace' | 'punctuation' | 'significant' {
  if (isWhitespaceToken(token)) return 'whitespace';
  return kindOf(token.codePointAt(0)!) === Kind.Punctuation ? 'punctuation' : 'significant';
}

/** A token that only consists of whitespace (an attached combining mark makes it a normal token). */
export const isWhitespaceToken = (token: string): boolean => {
  for (const ch of token) if (!isWhitespaceCodePoint(ch.codePointAt(0)!)) return false;
  return token.length > 0;
};
