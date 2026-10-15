// Natural sort key of a line (Paket 9 C1). Contract: tests/fixtures/sort-cases.json (rules N1-N5),
// docs/analyse/Paket9-PhaseB-Sortiervertrag.md. Framework-free.
//
// A line is split once into tokens: numbers and the text between them.
// - Number: a run of ASCII digits. No dates, hexadecimal or scientific notation (N5): `0x1F` is 0, "x", 1, "F".
// - Boundary: line start or directly after whitespace (Unicode White_Space set of Paket 8).
// - Sign: an ASCII '-' at a boundary, directly followed by a digit (`-5`, `Temp -5`). Not after letters, digits or
//   punctuation: `Datei-2` and `2020-12-01` keep '-' as text. '+' and U+2212 are text.
// - Decimal: a number that starts at a boundary (with or without sign) and has exactly one '.' followed by digits:
//   `1.10` = 1.1, `Preis 1.125`. With a second '.' + digit (`1.2.10`) or not at a boundary (`v1.10`), the point is
//   text and every digit run is its own number. A decimal needs digits on both sides (`.5`, `5.` are no decimals).
// - Values are kept as digit strings (no Number): any length, no precision loss. -0 equals 0.
// A text token that is followed by a number ends with DIGIT_PROBE, so that text is compared against "a digit follows"
// exactly where a number starts (`a1` vs `a-`: '0' vs '-'), like the ICU numeric collation.
import { isWhitespaceCodePoint as isWhitespace } from '../diff/whitespace.ts';

/** Stands for "a number follows" in text tokens; compared by the collation like any digit. */
export const DIGIT_PROBE = '0';

export interface NaturalNumber {
  /** -1, 0 or 1 (zero has no sign: -0 = 0) */
  sign: -1 | 0 | 1;
  /** Integer digits without leading zeros ('' for 0) */
  int: string;
  /** Fraction digits without trailing zeros ('' for none) */
  frac: string;
}

/** Text tokens are strings, numbers are objects. */
export type NaturalToken = string | NaturalNumber;

const isDigit = (code: number) => code >= 48 && code <= 57;
const MINUS = 45;
const POINT = 46;

function digitRunEnd(line: string, start: number): number {
  let end = start;
  while (end < line.length && isDigit(line.charCodeAt(end))) end++;
  return end;
}

function makeNumber(negative: boolean, intDigits: string, fracDigits: string): NaturalNumber {
  let i = 0;
  while (i < intDigits.length - 1 && intDigits.charCodeAt(i) === 48) i++;
  let int = intDigits.slice(i);
  if (int === '0') int = '';
  let end = fracDigits.length;
  while (end > 0 && fracDigits.charCodeAt(end - 1) === 48) end--;
  const frac = fracDigits.slice(0, end);
  const sign = int === '' && frac === '' ? 0 : negative ? -1 : 1;
  return { sign, int, frac };
}

/** Splits a line into text and number tokens (see the rules above). */
export function naturalTokens(line: string): NaturalToken[] {
  const tokens: NaturalToken[] = [];
  let textStart = 0;
  let i = 0;
  while (i < line.length) {
    const code = line.charCodeAt(i);
    const atBoundary = i === 0 || isWhitespace(line.charCodeAt(i - 1));
    const signed = code === MINUS && atBoundary && isDigit(line.charCodeAt(i + 1));
    if (!signed && !isDigit(code)) {
      i++;
      continue;
    }

    const digitsStart = signed ? i + 1 : i;
    const intEnd = digitRunEnd(line, digitsStart);
    let end = intEnd;
    let fracDigits = '';
    // Decimal only at a boundary, with exactly one point between digit runs
    if (atBoundary && line.charCodeAt(intEnd) === POINT && isDigit(line.charCodeAt(intEnd + 1))) {
      const fracEnd = digitRunEnd(line, intEnd + 1);
      const multiPart = line.charCodeAt(fracEnd) === POINT && isDigit(line.charCodeAt(fracEnd + 1));
      if (!multiPart) {
        fracDigits = line.slice(intEnd + 1, fracEnd);
        end = fracEnd;
      }
    }

    if (i > textStart) tokens.push(line.slice(textStart, i) + DIGIT_PROBE);
    tokens.push(makeNumber(signed, line.slice(digitsStart, intEnd), fracDigits));
    i = end;
    textStart = end;
  }
  if (textStart < line.length) tokens.push(line.slice(textStart));
  return tokens;
}

/** Numeric order of two numbers (exact, on digit strings). */
export function compareNaturalNumbers(a: NaturalNumber, b: NaturalNumber): number {
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  let magnitude = a.int.length - b.int.length;
  if (magnitude === 0) magnitude = a.int < b.int ? -1 : a.int > b.int ? 1 : 0;
  // Fraction digit strings: plain string order is the numeric order ('25' < '5', '1' < '125')
  if (magnitude === 0) magnitude = a.frac < b.frac ? -1 : a.frac > b.frac ? 1 : 0;
  return a.sign * Math.sign(magnitude);
}
