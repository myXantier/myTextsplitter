// Line orders of the Sort page (Paket 9 C1): a sort key per line, computed once, and a comparator on the keys.
// Contract: tests/fixtures/sort-cases.json (R2-R6, N1-N5). Framework-free.
//
// - Collation: ICU with the explicit locale 'de' (never the host locale), one cached Intl.Collator per sensitivity.
//   caseSensitive false = 'accent' (case ignored, accents relevant), true = 'variant' (case as tertiary criterion).
// - alphabetical: the collation of the whole line.
// - natural: the tokens of naturalKey.ts, compared level by level like the collation itself, so that case and accents
//   mean the same as in alphabetical (a later number difference outweighs an earlier case difference):
//     1. base letters and numeric values, 2. accents, 3. case (only caseSensitive),
//     4. spelling of equal numbers (`01`, `1`, `1.0`): the collation of the whole line (OD-6 B).
//   Each level is a total preorder on token lists (lexicographic; a number sorts where the collation puts a digit),
//   their lexicographic combination is one as well: antisymmetric and transitive.
// - length: Unicode code points (a surrogate pair counts 1, a lone surrogate 1).
// Equal keys compare as 0; the stable Array.prototype.sort keeps their input order.
import { compareNaturalNumbers, DIGIT_PROBE, naturalTokens, type NaturalToken } from './naturalKey.ts';

export const SORT_LOCALE = 'de';

type Sensitivity = 'base' | 'accent' | 'variant';
const collators = new Map<Sensitivity, Intl.Collator>();

/** Cached collator of the sort locale (numeric off, punctuation and whitespace not ignored). */
export function sortCollator(sensitivity: Sensitivity): Intl.Collator {
  let collator = collators.get(sensitivity);
  if (!collator) {
    collator = new Intl.Collator(SORT_LOCALE, { usage: 'sort', sensitivity, numeric: false, ignorePunctuation: false });
    collators.set(sensitivity, collator);
  }
  return collator;
}

export type SortKind = 'alphabetical' | 'natural' | 'length';

/** Sort key per line plus a comparator on the keys. */
export interface LineOrder<K> {
  key(line: string): K;
  compare(a: K, b: K): number;
}

/** Number of Unicode code points (UTF-16 surrogate pairs count once). */
export function codePointLength(line: string): number {
  let count = line.length;
  for (let i = 0; i < line.length - 1; i++) {
    const code = line.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = line.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        count--;
        i++;
      }
    }
  }
  return count;
}

/** Text vs. number: the number stands where the collation puts a digit. */
const textVersusNumber = (text: string, collator: Intl.Collator) => (collator.compare(text, DIGIT_PROBE) > 0 ? 1 : -1);

/** One level of the natural order: token lists compared lexicographically, the shorter prefix first. */
function compareTokens(a: readonly NaturalToken[], b: readonly NaturalToken[], collator: Intl.Collator, numbers: boolean): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i];
    const y = b[i];
    let result: number;
    if (typeof x === 'string') result = typeof y === 'string' ? collator.compare(x, y) : textVersusNumber(x, collator);
    else if (typeof y === 'string') result = -textVersusNumber(y, collator);
    else result = numbers ? compareNaturalNumbers(x, y) : 0;
    if (result !== 0) return result;
  }
  return a.length - b.length;
}

interface NaturalKey {
  line: string;
  tokens: NaturalToken[];
}

function naturalOrder(caseSensitive: boolean): LineOrder<NaturalKey> {
  const base = sortCollator('base');
  const accent = sortCollator('accent');
  const variant = sortCollator('variant');
  const spelling = caseSensitive ? variant : accent;
  return {
    key: (line) => ({ line, tokens: naturalTokens(line) }),
    compare(a, b) {
      if (a.line === b.line) return 0;
      return (
        compareTokens(a.tokens, b.tokens, base, true) ||
        compareTokens(a.tokens, b.tokens, accent, false) ||
        (caseSensitive ? compareTokens(a.tokens, b.tokens, variant, false) : 0) ||
        spelling.compare(a.line, b.line)
      );
    },
  };
}

function alphabeticalOrder(caseSensitive: boolean): LineOrder<string> {
  const collator = sortCollator(caseSensitive ? 'variant' : 'accent');
  return { key: (line) => line, compare: (a, b) => collator.compare(a, b) };
}

const LENGTH_ORDER: LineOrder<number> = { key: codePointLength, compare: (a, b) => a - b };

/** The order of a sort kind (ascending; descending methods negate `compare`). */
export function lineOrder(kind: SortKind, caseSensitive: boolean): LineOrder<unknown> {
  switch (kind) {
    case 'alphabetical':
      return alphabeticalOrder(caseSensitive);
    case 'natural':
      return naturalOrder(caseSensitive);
    case 'length':
      return LENGTH_ORDER;
  }
}

/** Comparator on lines (keys computed per call); for tests and single comparisons, sorting uses the keys once. */
export function lineComparator(kind: SortKind, caseSensitive: boolean): (a: string, b: string) => number {
  const order = lineOrder(kind, caseSensitive);
  return (a, b) => order.compare(order.key(a), order.key(b));
}
