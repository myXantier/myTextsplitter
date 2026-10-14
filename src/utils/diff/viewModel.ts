// View model of the diff (Paket 7, B3): turns a DiffDocument and, optionally, its word diff (IntralineAnalysis) into
// display rows for the unified and the split view. Pure function without UI framework imports, so another frontend
// (e.g. Angular) can render the same rows. It never compares lines or words itself: line pairs and word segments come
// only from the IntralineAnalysis (B2), moves only from the document (B1).
import type { DiffDocument, DiffLine, DiffRow, IntralineAnalysis, IntralinePair, IntralineSegment, IntralineSkipReason } from './types';

export type DiffViewKind = 'equal' | 'removed' | 'added';

/** One line on one side. */
export interface DiffViewCell {
  kind: DiffViewKind;
  /** Line number on this side: old for removed, new for added; equal cells of the split view use their own side */
  line: number;
  /** Original line text (an equal row of the unified view shows the new text) */
  text: string;
  /** Word diff of a changed line: `equal` + `delete` (old side) or `equal` + `insert` (new side); rebuilds `text` */
  segments?: IntralineSegment[];
  /** Changed line: line number of the paired line on the other side (word diff pair) */
  pairedLine?: number;
  /** Moved line (B1 move): its id and the line number on the other side */
  move?: { id: number; otherLine: number };
  /** The word diff left this line out because of a limit */
  wordDiffSkipped?: IntralineSkipReason;
}

/** Unified view: every line once, in document order, with its old and new line number. */
export interface UnifiedRow extends DiffViewCell {
  oldLine: number | null;
  newLine: number | null;
}

/** Split view: old text left, new text right; `null` is an empty cell (one-sided change). */
export interface SplitRow {
  old: DiffViewCell | null;
  new: DiffViewCell | null;
}

export interface DiffViewStats {
  unchanged: number;
  /** Removed and added lines without moves (a move is counted once, in `moved`); changed lines are part of them */
  removed: number;
  added: number;
  moved: number;
  /** Changed line pairs with word segments (0 without word diff) */
  changed: number;
  /** Lines the word diff left out because of a limit */
  wordDiffSkippedLines: number;
}

export interface DiffView {
  /** The word diff is shown (an analysis was given) */
  wordDiff: boolean;
  unified: UnifiedRow[];
  split: SplitRow[];
  stats: DiffViewStats;
  /** Lines without word diff per reason (both sides counted) */
  wordDiffSkips: Partial<Record<IntralineSkipReason, number>>;
}

/**
 * Builds the rows. Unified: the document rows in their order (between two equal lines all removed, then all added
 * lines). Split: per hunk the removed lines left and the added lines right; a word diff pair always shares one row,
 * the other lines of the hunk are placed side by side in their order between the pairs (no word comparison for them).
 * Deterministic: depends only on the document and the analysis.
 */
export function buildDiffView(document: DiffDocument, intraline: IntralineAnalysis | null): DiffView {
  const pairOfOld = new Map<number, IntralinePair>();
  const pairOfNew = new Map<number, IntralinePair>();
  const skipOfOld = new Map<number, IntralineSkipReason>();
  const skipOfNew = new Map<number, IntralineSkipReason>();
  const wordDiffSkips: Partial<Record<IntralineSkipReason, number>> = {};
  const countSkip = (reason: IntralineSkipReason, lines: number) => (wordDiffSkips[reason] = (wordDiffSkips[reason] ?? 0) + lines);
  let changed = 0;
  for (const pair of intraline?.pairs ?? []) {
    pairOfOld.set(pair.oldLine, pair);
    pairOfNew.set(pair.newLine, pair);
    if (pair.skipped) {
      skipOfOld.set(pair.oldLine, pair.skipped);
      skipOfNew.set(pair.newLine, pair.skipped);
      countSkip(pair.skipped, 2);
    } else {
      changed++;
    }
  }
  for (const skip of intraline?.skipped ?? []) {
    for (const line of skip.old) skipOfOld.set(line, skip.reason);
    for (const line of skip.new) skipOfNew.set(line, skip.reason);
    countSkip(skip.reason, skip.old.length + skip.new.length);
  }
  const moveOld = new Map(document.moves.map((m) => [m.oldLine, { id: m.id, otherLine: m.newLine }]));
  const moveNew = new Map(document.moves.map((m) => [m.newLine, { id: m.id, otherLine: m.oldLine }]));

  const changedCell = (kind: 'removed' | 'added', { line, text }: DiffLine): DiffViewCell => {
    const old = kind === 'removed';
    const pair = (old ? pairOfOld : pairOfNew).get(line);
    const segments = pair && (old ? pair.old : pair.new);
    const move = (old ? moveOld : moveNew).get(line);
    const skipped = (old ? skipOfOld : skipOfNew).get(line);
    return {
      kind,
      line,
      text,
      ...(segments ? { segments } : {}),
      ...(pair ? { pairedLine: old ? pair.newLine : pair.oldLine } : {}),
      ...(move ? { move } : {}),
      ...(skipped ? { wordDiffSkipped: skipped } : {}),
    };
  };

  const unified: UnifiedRow[] = document.rows.map((row) => {
    if (row.kind === 'equal') return { kind: 'equal', line: row.new.line, text: row.new.text, oldLine: row.old.line, newLine: row.new.line };
    if (row.kind === 'delete') return { ...changedCell('removed', row.old), oldLine: row.old.line, newLine: null };
    return { ...changedCell('added', row.new), oldLine: null, newLine: row.new.line };
  });

  const split: SplitRow[] = [];
  let removed: DiffViewCell[] = [];
  let added: DiffViewCell[] = [];
  const sideBySide = (left: DiffViewCell[], right: DiffViewCell[]) => {
    for (let k = 0; k < Math.max(left.length, right.length); k++) split.push({ old: left[k] ?? null, new: right[k] ?? null });
  };
  const flushHunk = () => {
    let l = 0;
    let r = 0;
    const indexOfAdded = new Map(added.map((cell, index) => [cell.line, index]));
    removed.forEach((cell, index) => {
      // Pairs are in order (B2), so a partner always lies after the previous one
      const partner = cell.pairedLine === undefined ? -1 : (indexOfAdded.get(cell.pairedLine) ?? -1);
      if (partner < r) return;
      sideBySide(removed.slice(l, index), added.slice(r, partner));
      split.push({ old: cell, new: added[partner] });
      l = index + 1;
      r = partner + 1;
    });
    sideBySide(removed.slice(l), added.slice(r));
    removed = [];
    added = [];
  };
  for (const row of document.rows as DiffRow[]) {
    if (row.kind === 'equal') {
      flushHunk();
      split.push({ old: { kind: 'equal', line: row.old.line, text: row.old.text }, new: { kind: 'equal', line: row.new.line, text: row.new.text } });
    } else if (row.kind === 'delete') {
      removed.push(changedCell('removed', row.old));
    } else {
      added.push(changedCell('added', row.new));
    }
  }
  flushHunk();

  const { unchanged, removed: removedCount, added: addedCount, moved } = document.stats;
  const wordDiffSkippedLines = Object.values(wordDiffSkips).reduce((sum, n) => sum + (n ?? 0), 0);
  return {
    wordDiff: intraline !== null,
    unified,
    split,
    stats: { unchanged, removed: removedCount, added: addedCount, moved, changed, wordDiffSkippedLines },
    wordDiffSkips,
  };
}

/**
 * Text form of the diff for copying (unified view): one line per row, `"  "` unchanged, `"- "` removed, `"+ "` added
 * (moved lines too, at their old and their new position), joined with LF. No JSON, no markup.
 */
export function formatDiffText(view: DiffView): string {
  const prefix = { equal: '  ', removed: '- ', added: '+ ' } as const;
  return view.unified.map((row) => prefix[row.kind] + row.text).join('\n');
}
