// Optional word diff (Paket 7, B2): a pure analysis of a finished `DiffDocument`. It never changes the document or
// the line diff, and nothing of it runs unless `computeIntraline` is called (the line diff does not import this
// module). Same algorithm in Rust (`src-tauri/src/diff/intraline.rs`); shared fixtures
// `tests/fixtures/intraline-cases.json`.
//
// 1. Hunks: maximal runs of delete/insert rows between two equal rows. Moved lines (`moveId`) and lines without any
//    non-whitespace token take no part.
// 2. Pairing inside a hunk only: similarity = Dice coefficient 2 * common / total of the similarity tokens of both
//    lines (multisets): the significant tokens (words, numbers, CJK, emoji, symbols); a line without any significant
//    token (only punctuation) uses its punctuation tokens instead. Punctuation alone never pairs two lines with words
//    (`Alphabeta.` / `Zyxwvu.`: 0 common). A pair needs similarity >= 0.5 (integer check `4 * common >= total`). An order-preserving
//    dynamic program picks the pairs with the highest total score (score = floor(2,000,000 * common / total)); on equal
//    totals the earliest old line is paired (traceback: pair, else skip a new line, else skip an old line). Every line
//    is in at most one pair; unpaired lines get no word diff.
// 3. Token diff of each pair with the Myers alignment of the line diff (same tie-break), in two steps: first the
//    non-whitespace tokens; then, if whitespace counts (`ignoreWhitespace` off), the whitespace tokens inside each gap
//    between two consecutive matched tokens (so a changed space never turns an unchanged word into delete + insert).
//    With `ignoreWhitespace`, whitespace tokens are never compared and never highlighted.
//
// Limits (deterministic counts, identical in Rust): see `INTRALINE_LIMITS`. A limit never yields partial segments:
// the line, hunk or pair is listed with its skip reason and keeps its normal delete/insert rows.
import { alignSequences, DiffLimitError } from './myers';
import { tokenize, tokenClass, isWhitespaceToken } from './tokenize';
import type { DiffDocument, DiffLine, IntralineAnalysis, IntralinePair, IntralineSegment, IntralineSkip } from './types';

export interface IntralineLimits {
  /** Tokens per line; a longer line takes no part (`lineTooLong`). */
  maxLineTokens: number;
  /** Deleted lines x inserted lines (not moved) of one hunk, checked before any tokenization (`hunkTooLarge`). */
  maxPairingCells: number;
  /** Myers work units of one token alignment (`tooComplex`). */
  maxPairWork: number;
  /** Work units of the whole analysis: tokens + similarity cells (tokens of both lines) + token alignments. When it is
   * exceeded, the current and every later hunk are skipped (`budgetExceeded`). */
  budget: number;
}

/**
 * Chosen limits: 500 tokens cover long prose lines (about 250 words) while one alignment stays far below 1,000,000
 * work units; 2,500 cells (e.g. 50 x 50 lines) keep the pairing at most 2,500 similarity checks per hunk; the budget
 * of 2,000,000 units is about 1-1.5 s in JS in the worst measured cases (25,000 short pairs: 1 s; 2,000 changed lines
 * of 481 tokens: 1.45 s, then budgetExceeded; Rust is faster), well inside the 15 s worker timeout.
 */
export const INTRALINE_LIMITS: IntralineLimits = {
  maxLineTokens: 500,
  maxPairingCells: 2_500,
  maxPairWork: 1_000_000,
  budget: 2_000_000,
};

class BudgetExceeded extends Error {}

interface Candidate {
  line: number;
  tokens: string[];
  /** Similarity tokens (see `similarityTokens`) with their counts */
  bag: Map<string, number>;
  similarityCount: number;
  /** Non-whitespace tokens: the cost of a similarity check */
  contentCount: number;
}

/** Tokens that decide the line similarity: the significant ones, or the punctuation of a line without them. */
export function similarityTokens(tokens: string[]): string[] {
  const significant = tokens.filter((t) => tokenClass(t) === 'significant');
  return significant.length ? significant : tokens.filter((t) => tokenClass(t) === 'punctuation');
}

interface Hunk {
  deletes: DiffLine[];
  inserts: DiffLine[];
}

/** Hunks with at least one deleted and one inserted line (moved lines excluded), in row order. */
function hunksOf(document: DiffDocument): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk = { deletes: [], inserts: [] };
  const close = () => {
    if (current.deletes.length && current.inserts.length) hunks.push(current);
    current = { deletes: [], inserts: [] };
  };
  for (const row of document.rows) {
    if (row.kind === 'equal') close();
    else if (row.moveId !== undefined) continue;
    else if (row.kind === 'delete') current.deletes.push(row.old);
    else current.inserts.push(row.new);
  }
  close();
  return hunks;
}

export function computeIntraline(document: DiffDocument, limits: IntralineLimits = INTRALINE_LIMITS): IntralineAnalysis {
  const ignoreWhitespace = document.options.ignoreWhitespace;
  const pairs: IntralinePair[] = [];
  const skipped: IntralineSkip[] = [];
  let work = 0;
  let exhausted = false;
  const spend = (units: number) => {
    work += units;
    if (work > limits.budget) throw new BudgetExceeded();
  };

  for (const hunk of hunksOf(document)) {
    const allLines = { old: hunk.deletes.map((l) => l.line), new: hunk.inserts.map((l) => l.line) };
    if (exhausted) {
      skipped.push({ reason: 'budgetExceeded', ...allLines });
      continue;
    }
    if (hunk.deletes.length * hunk.inserts.length > limits.maxPairingCells) {
      skipped.push({ reason: 'hunkTooLarge', ...allLines });
      continue;
    }
    const start = work;
    const hunkPairs: IntralinePair[] = [];
    const hunkSkips: IntralineSkip[] = [];
    try {
      analyzeHunk(hunk, ignoreWhitespace, limits, spend, () => limits.budget - work, hunkPairs, hunkSkips);
      pairs.push(...hunkPairs);
      skipped.push(...hunkSkips);
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) throw error;
      // Nothing of this hunk is delivered; its work is not counted
      work = start;
      exhausted = true;
      skipped.push({ reason: 'budgetExceeded', ...allLines });
    }
  }
  return { version: 1, ignoreWhitespace, pairs, skipped, work };
}

function analyzeHunk(
  hunk: Hunk,
  ignoreWhitespace: boolean,
  limits: IntralineLimits,
  spend: (units: number) => void,
  remaining: () => number,
  pairs: IntralinePair[],
  skips: IntralineSkip[],
) {
  const candidates = (lines: DiffLine[], side: 'old' | 'new') => {
    const out: Candidate[] = [];
    for (const { line, text } of lines) {
      const tokens = tokenize(text);
      spend(tokens.length);
      if (tokens.length > limits.maxLineTokens) {
        skips.push({ reason: 'lineTooLong', old: side === 'old' ? [line] : [], new: side === 'new' ? [line] : [] });
        continue;
      }
      const contentCount = tokens.filter((t) => !isWhitespaceToken(t)).length;
      if (contentCount === 0) continue;
      const similar = similarityTokens(tokens);
      const bag = new Map<string, number>();
      for (const token of similar) bag.set(token, (bag.get(token) ?? 0) + 1);
      out.push({ line, tokens, bag, similarityCount: similar.length, contentCount });
    }
    return out;
  };
  const olds = candidates(hunk.deletes, 'old');
  const news = candidates(hunk.inserts, 'new');
  const rows = olds.length;
  const cols = news.length;
  if (!rows || !cols) return;

  // Similarity of every candidate pair
  const common = new Int32Array(rows * cols);
  const score = new Float64Array(rows * cols).fill(-1);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      spend(olds[i].contentCount + news[j].contentCount);
      const total = olds[i].similarityCount + news[j].similarityCount;
      const c = commonCount(olds[i].bag, news[j].bag);
      common[i * cols + j] = c;
      if (4 * c >= total) score[i * cols + j] = Math.floor((2_000_000 * c) / total);
    }
  }

  // Order-preserving pairing with the highest total score (suffix DP; ties: pair the earliest lines)
  const width = cols + 1;
  const best = new Float64Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      const s = score[i * cols + j];
      best[i * width + j] = Math.max(best[(i + 1) * width + j], best[i * width + j + 1], s >= 0 ? s + best[(i + 1) * width + j + 1] : -1);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    const s = score[i * cols + j];
    if (s >= 0 && best[i * width + j] === s + best[(i + 1) * width + j + 1]) {
      const total = olds[i].similarityCount + news[j].similarityCount;
      pairs.push(tokenDiff(olds[i], news[j], { common: common[i * cols + j], total }, ignoreWhitespace, limits, spend, remaining));
      i++;
      j++;
    } else if (best[i * width + j] === best[i * width + j + 1]) {
      j++;
    } else {
      i++;
    }
  }
}

function commonCount(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const [token, n] of small) count += Math.min(n, large.get(token) ?? 0);
  return count;
}

function tokenDiff(
  oldLine: Candidate,
  newLine: Candidate,
  similarity: IntralinePair['similarity'],
  ignoreWhitespace: boolean,
  limits: IntralineLimits,
  spend: (units: number) => void,
  remaining: () => number,
): IntralinePair {
  const ids = new Map<string, number>();
  const idOf = (token: string) => {
    let id = ids.get(token);
    if (id === undefined) {
      id = ids.size;
      ids.set(token, id);
    }
    return id;
  };
  const matchedOld = new Uint8Array(oldLine.tokens.length);
  const matchedNew = new Uint8Array(newLine.tokens.length);
  let pairWork = 0;
  /** Aligns the tokens at the given indices and marks the matched ones; false if the pair is too complex. */
  const align = (oldIndex: number[], newIndex: number[]): boolean => {
    if (!oldIndex.length || !newIndex.length) return true;
    const a = Int32Array.from(oldIndex, (k) => idOf(oldLine.tokens[k]));
    const b = Int32Array.from(newIndex, (k) => idOf(newLine.tokens[k]));
    const left = remaining();
    const pairLeft = limits.maxPairWork - pairWork;
    const limit = Math.min(pairLeft, left);
    let matches;
    try {
      matches = alignSequences(a, b, ids.size, limit);
    } catch (error) {
      if (!(error instanceof DiffLimitError)) throw error;
      // The budget is the tighter limit: the whole analysis stops here; otherwise only this pair is skipped
      if (left <= pairLeft) throw new BudgetExceeded();
      spend(limit);
      return false;
    }
    spend(matches.work);
    pairWork += matches.work;
    for (const k of matches.old) matchedOld[oldIndex[k]] = 1;
    for (const k of matches.new) matchedNew[newIndex[k]] = 1;
    return true;
  };
  const tooComplex = (): IntralinePair => ({ oldLine: oldLine.line, newLine: newLine.line, similarity, skipped: 'tooComplex' });

  // 1. Non-whitespace tokens
  const content = (tokens: string[]) => tokens.flatMap((token, index) => (isWhitespaceToken(token) ? [] : [index]));
  const oldContent = content(oldLine.tokens);
  const newContent = content(newLine.tokens);
  if (!align(oldContent, newContent)) return tooComplex();

  // 2. Whitespace tokens inside each gap between consecutive matched content tokens (also before the first/after the last)
  if (!ignoreWhitespace) {
    const anchorsOld = [-1, ...oldContent.filter((k) => matchedOld[k]), oldLine.tokens.length];
    const anchorsNew = [-1, ...newContent.filter((k) => matchedNew[k]), newLine.tokens.length];
    for (let g = 1; g < anchorsOld.length; g++) {
      const gap = (tokens: string[], from: number, to: number) => {
        const out: number[] = [];
        for (let k = from + 1; k < to; k++) if (isWhitespaceToken(tokens[k])) out.push(k);
        return out;
      };
      if (!align(gap(oldLine.tokens, anchorsOld[g - 1], anchorsOld[g]), gap(newLine.tokens, anchorsNew[g - 1], anchorsNew[g]))) return tooComplex();
    }
  }

  return {
    oldLine: oldLine.line,
    newLine: newLine.line,
    similarity,
    old: segments(oldLine.tokens, matchedOld, 'delete', ignoreWhitespace),
    new: segments(newLine.tokens, matchedNew, 'insert', ignoreWhitespace),
  };
}

/**
 * Segments of one side: adjacent tokens with the same op are joined. An unchanged whitespace-only segment between two
 * changes of this side joins them (`+"morgen" " " +"früh"` -> `+"morgen früh"`), as in the GitHub diff.
 */
function segments(tokens: string[], matched: Uint8Array, changed: 'delete' | 'insert', ignoreWhitespace: boolean): IntralineSegment[] {
  const out: IntralineSegment[] = [];
  const push = (op: IntralineSegment['op'], text: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  tokens.forEach((text, index) => {
    const op = matched[index] || (ignoreWhitespace && isWhitespaceToken(text)) ? 'equal' : changed;
    // [changed, whitespace-only equal] followed by a change: one change
    const gap = out.length >= 2 ? out[out.length - 1] : undefined;
    if (op === changed && gap?.op === 'equal' && out[out.length - 2].op === changed && isWhitespaceToken(gap.text)) {
      out.pop();
      out[out.length - 1].text += gap.text + text;
      return;
    }
    push(op, text);
  });
  return out;
}

// --- validation (runtime check at a Worker/IPC boundary in B3, and for tests) ---

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isLineList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((line, k) => Number.isSafeInteger(line) && line >= 1 && (k === 0 || line > value[k - 1]));
const HUNK_REASONS = ['hunkTooLarge', 'budgetExceeded'];

/**
 * Error of `value` as word diff of `document` (a valid DiffDocument), or `null`. Accepts any value (`unknown`, e.g.
 * from a Worker or IPC message) and never throws. Linear in the size of both, no new alignment:
 * - structure: exact fields, version 1, the document's whitespace option, `work` a non-negative safe integer;
 * - pairs: a deleted and an inserted line (not moved) of the same hunk, ascending, each line at most once; the claimed
 *   similarity is recomputed from the tokens of both lines (similarity tokens) and must reach 0.5;
 * - either segments (rebuilding both lines exactly, valid ops per side, no empty or repeated op, the same unchanged
 *   content on both sides, with ignoreWhitespace no whitespace-only change) or `skipped: 'tooComplex'`;
 * - skips: known reasons; `lineTooLong` names one deleted or inserted line; `hunkTooLarge`/`budgetExceeded` name all
 *   deleted and inserted lines of one hunk; no line is in two entries (pairs and skips).
 */
export function intralineError(value: unknown, document: DiffDocument): string | null {
  try {
    if (!isRecord(value) || !hasKeys(value, ['version', 'ignoreWhitespace', 'pairs', 'skipped', 'work'])) return 'not an intraline analysis';
    const { version, ignoreWhitespace, pairs, skipped, work } = value;
    if (version !== 1) return 'unsupported version';
    if (ignoreWhitespace !== document.options.ignoreWhitespace) return 'options do not match';
    if (!isCount(work)) return 'invalid work';
    if (!Array.isArray(pairs) || !Array.isArray(skipped)) return 'invalid pairs or skips';

    // Hunk of every deleted/inserted (not moved) line and the lines of every hunk
    const oldRows = new Map<number, { hunk: number; text: string }>();
    const newRows = new Map<number, { hunk: number; text: string }>();
    const hunkLines = new Map<number, { old: number[]; new: number[] }>();
    let hunk = 0;
    for (const row of document.rows) {
      if (row.kind === 'equal') {
        hunk++;
        continue;
      }
      if (row.moveId !== undefined) continue;
      const lines = hunkLines.get(hunk) ?? { old: [], new: [] };
      hunkLines.set(hunk, lines);
      if (row.kind === 'delete') {
        oldRows.set(row.old.line, { hunk, text: row.old.text });
        lines.old.push(row.old.line);
      } else {
        newRows.set(row.new.line, { hunk, text: row.new.text });
        lines.new.push(row.new.line);
      }
    }
    const usedOld = new Set<number>();
    const usedNew = new Set<number>();
    const use = (lines: number[], used: Set<number>) => lines.every((line) => !used.has(line) && used.add(line));

    let prevOld = 0;
    let prevNew = 0;
    for (const pair of pairs) {
      if (!isRecord(pair) || !hasKeys(pair, ['oldLine', 'newLine', 'similarity'], ['old', 'new', 'skipped'])) return 'invalid pair';
      const { oldLine, newLine, similarity } = pair;
      if (!isCount(oldLine) || !isCount(newLine) || oldLine <= prevOld || newLine <= prevNew) return 'pairs not in order or a line paired twice';
      prevOld = oldLine;
      prevNew = newLine;
      const oldRow = oldRows.get(oldLine);
      const newRow = newRows.get(newLine);
      if (!oldRow || !newRow || oldRow.hunk !== newRow.hunk) return 'pair outside one hunk';
      if (!use([oldLine], usedOld) || !use([newLine], usedNew)) return 'line in two entries';

      if (!isRecord(similarity) || !hasKeys(similarity, ['common', 'total'])) return 'invalid similarity';
      const oldBag = bagOf(similarityTokens(tokenize(oldRow.text)));
      const newBag = bagOf(similarityTokens(tokenize(newRow.text)));
      const common = commonCount(oldBag.bag, newBag.bag);
      const total = oldBag.count + newBag.count;
      if (similarity.common !== common || similarity.total !== total) return 'similarity does not match the lines';
      if (total === 0 || 4 * common < total) return 'similarity below the threshold';

      if (pair.skipped !== undefined) {
        if (pair.skipped !== 'tooComplex' || pair.old !== undefined || pair.new !== undefined) return 'invalid skipped pair';
        continue;
      }
      if (!Array.isArray(pair.old) || !Array.isArray(pair.new)) return 'pair without segments';
      const error =
        sideError(pair.old, 'delete', oldRow.text, ignoreWhitespace as boolean) ?? sideError(pair.new, 'insert', newRow.text, ignoreWhitespace as boolean);
      if (error) return error;
      // Segments consist of whole tokens: tokenizing each one gives the original tokens (joining first could merge two)
      const unchanged = (segments: IntralineSegment[]) =>
        segments.flatMap((s) => (s.op === 'equal' ? tokenize(s.text).filter((t) => !isWhitespaceToken(t)) : [])).join('\u0000');
      if (unchanged(pair.old) !== unchanged(pair.new)) return 'unchanged content differs between the sides';
    }

    for (const skip of skipped) {
      if (!isRecord(skip) || !hasKeys(skip, ['reason', 'old', 'new']) || !isLineList(skip.old) || !isLineList(skip.new)) return 'invalid skip';
      const { reason, old, new: inserted } = skip;
      if (!old.every((line) => oldRows.has(line)) || !inserted.every((line) => newRows.has(line))) return 'skip of a line that is no deleted or inserted line';
      if (reason === 'lineTooLong') {
        if (old.length + inserted.length !== 1) return 'lineTooLong names more than one line';
      } else if (HUNK_REASONS.includes(reason as string)) {
        const lines = hunkLines.get((old.length ? oldRows.get(old[0]) : newRows.get(inserted[0]))?.hunk ?? -1);
        if (!lines || !lines.old.length || !lines.new.length || lines.old.join() !== old.join() || lines.new.join() !== inserted.join()) {
          return `${reason} does not name the lines of one hunk`;
        }
      } else {
        return 'unknown skip reason';
      }
      if (!use(old, usedOld) || !use(inserted, usedNew)) return 'line in two entries';
    }
    return null;
  } catch (error) {
    return `invalid intraline analysis: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function bagOf(tokens: string[]) {
  const bag = new Map<string, number>();
  for (const token of tokens) bag.set(token, (bag.get(token) ?? 0) + 1);
  return { bag, count: tokens.length };
}

function sideError(segments: unknown[], changed: 'delete' | 'insert', original: string, ignoreWhitespace: boolean): string | null {
  let rebuilt = '';
  for (let k = 0; k < segments.length; k++) {
    const segment = segments[k];
    if (!isRecord(segment) || !hasKeys(segment, ['op', 'text'])) return 'invalid segment';
    const { op, text } = segment;
    if ((op !== 'equal' && op !== changed) || typeof text !== 'string' || text === '') return 'invalid segment';
    if (k > 0 && (segments[k - 1] as IntralineSegment).op === op) return 'adjacent segments with the same op';
    if (ignoreWhitespace && op !== 'equal' && isWhitespaceToken(text)) return 'whitespace-only change with ignoreWhitespace';
    rebuilt += text;
  }
  return rebuilt === original ? null : 'segments do not rebuild the original line';
}
