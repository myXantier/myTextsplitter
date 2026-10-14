// Result model of the line diff (Paket 7, `DiffDocumentV2`). Same JSON shape in Rust (`src-tauri/src/diff/`) and
// TypeScript; framework independent (no React imports), so a later Angular UI can render the same document.
//
// Phase B1 computes lines only. B2 can add word segments without changing the line algorithm: `DiffLine.segments`
// (optional) and a `modified` row kind for paired lines are additions, not changes of the existing fields.

/** One line of the old or new text. `line` is 1-based; `text` is the original line content (never normalized). */
export interface DiffLine {
  line: number;
  text: string;
}

/** Unchanged line: its comparison keys are equal (the texts can differ when whitespace is ignored). */
export interface DiffRowEqual {
  kind: 'equal';
  old: DiffLine;
  new: DiffLine;
}

/** Line of the old text without counterpart. `moveId` links it to the insert it was moved to. */
export interface DiffRowDelete {
  kind: 'delete';
  old: DiffLine;
  moveId?: number;
}

/** Line of the new text without counterpart. `moveId` links it to the delete it was moved from. */
export interface DiffRowInsert {
  kind: 'insert';
  new: DiffLine;
  moveId?: number;
}

export type DiffRow = DiffRowEqual | DiffRowDelete | DiffRowInsert;

/** A moved line: exactly one delete row (`oldLine`) and one insert row (`newLine`) carry `moveId === id`. */
export interface DiffMove {
  id: number;
  oldLine: number;
  newLine: number;
}

/**
 * Counts without double counting. A move is counted once in `moved` and not in `removed`/`added`, so
 * `unchanged + removed + moved = oldLineCount` and `unchanged + added + moved = newLineCount`.
 */
export interface DiffStats {
  unchanged: number;
  removed: number;
  added: number;
  moved: number;
}

export interface DiffOptions {
  /** Leading/trailing whitespace is ignored and inner whitespace runs compare equal (see `whitespace.ts`). */
  ignoreWhitespace: boolean;
}

export interface DiffDocument {
  version: 2;
  options: DiffOptions;
  oldLineCount: number;
  newLineCount: number;
  /** Display order: matched lines in order; between two matches all deletes, then all inserts. */
  rows: DiffRow[];
  /** Ascending by `id` (= ascending by `oldLine`). */
  moves: DiffMove[];
  stats: DiffStats;
}
