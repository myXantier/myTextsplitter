// Match rows of the Filter pattern preview (MatchPreviewWorker, Paket 10 C2).
import { hasSurrogates, matchesWithoutCutCharacters, splitsSurrogatePair } from './regex.ts';

/**
 * Limits of one preview answer, enforced while it is built (Paket 10 E7, measured in tests/bench/preview-baseline.mjs):
 * the page renders one row at a time, but every span of that row costs layout time (20,000 spans block the UI ≈ 0.5–0.9 s,
 * 100,000 spans ≈ 18 s), and every stored segment costs memory in the worker and in the structured clone.
 */
export const PREVIEW_LIMITS = {
  /** Highlighted matches per row (≤ 2,001 segments: ≈ 40 ms rendering). Further matches of the line are not shown. */
  matchesPerRow: 1_000,
  /** Stored rows (lines with a match). */
  rows: 1_000,
  /** Segments of all rows (≈ 10,000 highlights). */
  segments: 20_001,
  /** A longer segment is shown shortened: its first and last `segmentKeep` UTF-16 units around an omission marker. */
  segmentChars: 200,
  segmentKeep: 80,
  /** UTF-16 units stored over all rows (≈ 400 KB in the answer). */
  chars: 200_000,
} as const;
export type PreviewLimits = { [K in keyof typeof PREVIEW_LIMITS]: number };

/** A shortened segment: `omitted` UTF-16 units of the original segment were left out at offset `at` of its text. */
export interface PreviewElision {
  segment: number;
  at: number;
  omitted: number;
}

/**
 * One line with at least one highlighted match. `segments` alternate text and match (`[text, match, …, text]`, even
 * indexes = text, odd = matches, matches are never empty). Without `elided` entries and with `restOmitted` = 0 the
 * segments rebuild the line exactly; otherwise the shown text is visibly shortened (never silently).
 */
export interface PreviewRow {
  /** 1-based line number in the source text */
  line: number;
  segments: string[];
  elided: PreviewElision[];
  /** UTF-16 units at the end of the line that are not shown (row cut by a limit; further matches may be there) */
  restOmitted: number;
}

export interface MatchPreviewData {
  rows: PreviewRow[];
  /** Highlighted matches in `rows`; with `complete` = false only a lower bound */
  matches: number;
  /** false: a limit stopped the preview (more lines or matches may exist); the search was not continued */
  complete: boolean;
  /**
   * With `splitMatches` on, some highlights join two adjacent matches at a boundary inside a surrogate pair: "keep"
   * with split matches would put the halves on different lines and the Filter refuses it; "remove" and "keep" without
   * splitting work.
   */
  keepSplitCutsCharacter: boolean;
}

/** A segment as stored: shortened around the middle if it is longer than `segmentChars` (never inside a surrogate pair). */
function shorten(text: string, limits: PreviewLimits): { text: string; at: number; omitted: number } {
  if (text.length <= limits.segmentChars) return { text, at: 0, omitted: 0 };
  let headEnd = limits.segmentKeep;
  if (splitsSurrogatePair(text, headEnd)) headEnd--;
  let tailStart = text.length - limits.segmentKeep;
  if (splitsSurrogatePair(text, tailStart)) tailStart++;
  return { text: text.slice(0, headEnd) + text.slice(tailStart), at: headEnd, omitted: tailStart - headEnd };
}

/**
 * Builds the preview rows of `lines` for the global regex `regex` (flags of the Filter, no `u`).
 *
 * Cut characters (Paket 10 E1) are judged like the JS Filter (`matchesWithoutCutCharacters` of Paket 8): with adjacent
 * matches joined, as in "remove" and in "keep" without split matches. A match that cuts a character in every mode
 * throws `regexSplitsCharacter` (the Filter refuses the text; no highlight of a lone half). Adjacent matches whose common
 * boundary lies inside a surrogate pair are shown as one highlight; with `splitMatches` that is reported as
 * `keepSplitCutsCharacter`. Zero-width matches are not highlighted. Lone surrogates of the input are no cut.
 *
 * The limits stop the search as soon as one is reached: no match list is built, at most one pending highlight is kept.
 */
export function buildMatchPreview(lines: string[], regex: RegExp, splitMatches: boolean, limits: PreviewLimits = PREVIEW_LIMITS): MatchPreviewData {
  const rows: PreviewRow[] = [];
  let matches = 0;
  let segmentCount = 0;
  let chars = 0;
  let complete = true;
  /** A limit of the whole answer was reached: no further line is searched */
  let stopped = false;
  let joinedHalves = false;

  for (let index = 0; index < lines.length && !stopped; index++) {
    const line = lines[index];
    const segments: string[] = [];
    const elided: PreviewElision[] = [];
    let last = 0;
    let rowMatches = 0;
    let rowCut = false;
    /** Highlight not stored yet (it may still be joined with the next match) */
    let pending: { start: number; end: number } | null = null;

    const push = (shortened: { text: string; at: number; omitted: number }) => {
      if (shortened.omitted) elided.push({ segment: segments.length, at: shortened.at, omitted: shortened.omitted });
      segments.push(shortened.text);
      chars += shortened.text.length;
    };
    /** The limits of the whole answer stop the search here: the rest of the row is not shown */
    const stop = () => {
      rowCut = true;
      stopped = true;
    };
    /** Stores the pending highlight with the text before it; false if a limit does not allow it */
    const flush = (highlight: { start: number; end: number }): boolean => {
      if (rowMatches === limits.matchesPerRow) {
        rowCut = true;
        return false;
      }
      // Two segments for this highlight, one for the final text of the row; the stored (shortened) units must fit
      const before = shorten(line.slice(last, highlight.start), limits);
      const match = shorten(line.slice(highlight.start, highlight.end), limits);
      if (segmentCount + segments.length + 3 > limits.segments || chars + before.text.length + match.text.length > limits.chars) {
        stop();
        return false;
      }
      push(before);
      push(match);
      last = highlight.end;
      rowMatches++;
      return true;
    };

    const found = hasSurrogates(line) ? matchesWithoutCutCharacters(line, regex, true) : line.matchAll(regex);
    for (const match of found) {
      const start = match.index!;
      const end = start + match[0].length;
      if (start === end) continue;
      if (pending && start === pending.end && splitsSurrogatePair(line, start)) {
        pending.end = end;
        joinedHalves = true;
        continue;
      }
      if (pending && !flush(pending)) break;
      pending = { start, end };
    }
    if (pending && !rowCut) flush(pending);
    // The final text of the row counts against the char budget too: if it does not fit, the row is cut there
    const rest = rowMatches && !rowCut ? shorten(line.slice(last), limits) : null;
    if (rest && chars + rest.text.length > limits.chars) stop();

    if (rowMatches) {
      if (rowCut) {
        // The rest of the line (with further matches) is not shown
        segments.push('');
        rows.push({ line: index + 1, segments, elided, restOmitted: line.length - last });
        complete = false;
      } else {
        push(rest!);
        rows.push({ line: index + 1, segments, elided, restOmitted: 0 });
      }
      matches += rowMatches;
      segmentCount += segments.length;
      if (rows.length === limits.rows) stopped = true;
    }
    // A row cut only hides the rest of its line, a stop every later line
    if (rowCut || (stopped && index < lines.length - 1)) complete = false;
  }

  return { rows, matches, complete, keepSplitCutsCharacter: splitMatches && joinedHalves };
}
