// Line diff (Paket 7, B1): alignment -> rows -> moves -> statistics. Pure function, same algorithm as Rust
// (`src-tauri/src/diff/mod.rs`); the shared fixtures `tests/fixtures/diff-cases.json` check the complete result.
import { splitLines } from '../lines';
import { alignSequences } from './myers';
import { comparisonKey, isBlankLine } from './whitespace';
import type { DiffDocument, DiffMove, DiffOptions, DiffRow } from './types';

/**
 * Compares the data lines of both texts (shared line model: LF/CRLF/CR and a trailing newline are no difference,
 * an empty text has no lines). Throws `DiffLimitError` if the alignment exceeds `DIFF_WORK_LIMIT`.
 *
 * Rows: matched lines in order; between two matched lines first all deleted, then all inserted lines (each group
 * in text order). Moves: see `detectMoves`.
 */
export function computeLineDiff(oldText: string, newText: string, options: DiffOptions): DiffDocument {
  const oldLines = splitLines(oldText).lines;
  const newLines = splitLines(newText).lines;

  // Key ids in order of first appearance (old text first): equal ids = equal comparison keys
  const ids = new Map<string, number>();
  const toIds = (lines: string[]) =>
    Int32Array.from(lines, (line) => {
      const key = comparisonKey(line, options.ignoreWhitespace);
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      return id;
    });
  const oldIds = toIds(oldLines);
  const newIds = toIds(newLines);

  const matches = alignSequences(oldIds, newIds, ids.size);

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  const emitChanges = (oldEnd: number, newEnd: number) => {
    for (; i < oldEnd; i++) rows.push({ kind: 'delete', old: { line: i + 1, text: oldLines[i] } });
    for (; j < newEnd; j++) rows.push({ kind: 'insert', new: { line: j + 1, text: newLines[j] } });
  };
  for (let m = 0; m < matches.old.length; m++) {
    emitChanges(matches.old[m], matches.new[m]);
    rows.push({ kind: 'equal', old: { line: i + 1, text: oldLines[i] }, new: { line: j + 1, text: newLines[j] } });
    i++;
    j++;
  }
  emitChanges(oldLines.length, newLines.length);

  const moves = detectMoves(rows, oldIds, newIds, ids.size);
  const moved = moves.length;
  const unchanged = matches.old.length;
  return {
    version: 2,
    options: { ignoreWhitespace: options.ignoreWhitespace },
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    rows,
    moves,
    stats: {
      unchanged,
      removed: oldLines.length - unchanged - moved,
      added: newLines.length - unchanged - moved,
      moved,
    },
  };
}

/**
 * Moves (conservative, B1): a delete and an insert are linked only if their comparison key occurs exactly once in
 * the old and exactly once in the new text (then that single occurrence is this delete and this insert), and the
 * line is not blank. Duplicates and blank lines always stay delete + insert. Rows keep their positions; the move
 * only adds `moveId` to both. Ids are assigned in ascending order of the old line.
 */
function detectMoves(rows: DiffRow[], oldIds: Int32Array, newIds: Int32Array, idCount: number): DiffMove[] {
  const oldCount = new Uint32Array(idCount);
  const newCount = new Uint32Array(idCount);
  for (const id of oldIds) oldCount[id]++;
  for (const id of newIds) newCount[id]++;
  const unique = (id: number) => oldCount[id] === 1 && newCount[id] === 1;

  // Insert row per unique id
  const insertOf = new Map<number, DiffRow & { kind: 'insert' }>();
  for (const row of rows) {
    if (row.kind === 'insert') {
      const id = newIds[row.new.line - 1];
      if (unique(id)) insertOf.set(id, row);
    }
  }

  const moves: DiffMove[] = [];
  for (const row of rows) {
    if (row.kind !== 'delete') continue;
    const id = oldIds[row.old.line - 1];
    const insert = unique(id) ? insertOf.get(id) : undefined;
    if (!insert || isBlankLine(row.old.text)) continue;
    const move: DiffMove = { id: moves.length + 1, oldLine: row.old.line, newLine: insert.new.line };
    row.moveId = move.id;
    insert.moveId = move.id;
    moves.push(move);
  }
  return moves;
}
