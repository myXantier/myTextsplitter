// Runtime validation of a `DiffDocument` from another context (Rust IPC, Web Worker). Checks the structure and every
// invariant of the line diff, so a corrupted or partial result is rejected instead of being displayed.
import type { DiffDocument } from './types';
import { comparisonKey, isBlankLine } from './whitespace';

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const hasExactKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

function line(value: unknown, count: number): { line: number; text: string } {
  if (!isObject(value) || !hasExactKeys(value, ['line', 'text']) || typeof value.text !== 'string') throw new Error('invalid line');
  if (!Number.isInteger(value.line) || (value.line as number) < 1 || (value.line as number) > count) throw new Error('line out of range');
  return value as { line: number; text: string };
}

/**
 * Returns the error of `value` as diff document, or `null` if it is valid:
 * - every old line 1..oldLineCount and every new line 1..newLineCount occurs exactly once, in ascending order
 *   (so equal lines keep their relative order on both sides);
 * - every move has exactly one delete (its `oldLine`) and one insert (its `newLine`) with its id; ids are 1..n,
 *   ascending with the old line;
 * - the statistics equal the counted rows (a move is counted once, in `moved`);
 * - semantics (linear, no new alignment): equal rows have equal comparison keys (`options.ignoreWhitespace`); a move
 *   links equal keys that occur exactly once in each text and are not blank, and every such delete/insert pair is a move.
 */
export function diffDocumentError(value: unknown): string | null {
  try {
    if (!isObject(value) || !hasExactKeys(value, ['version', 'options', 'oldLineCount', 'newLineCount', 'rows', 'moves', 'stats'])) {
      return 'not a diff document';
    }
    const { version, options, oldLineCount, newLineCount, rows, moves, stats } = value;
    if (version !== 2) return 'unsupported version';
    if (!isObject(options) || !hasExactKeys(options, ['ignoreWhitespace']) || typeof options.ignoreWhitespace !== 'boolean') return 'invalid options';
    if (!isCount(oldLineCount) || !isCount(newLineCount) || !Array.isArray(rows) || !Array.isArray(moves)) return 'invalid counts';

    const ignoreWhitespace = options.ignoreWhitespace;
    const key = (text: string) => comparisonKey(text, ignoreWhitespace);
    let nextOld = 1;
    let nextNew = 1;
    let equal = 0;
    // Key counts per text and the delete/insert rows, for the move rules
    const oldKeys = new Map<string, number>();
    const newKeys = new Map<string, number>();
    const count = (keys: Map<string, number>, text: string) => keys.set(key(text), (keys.get(key(text)) ?? 0) + 1);
    const deletes: { text: string; moveId: unknown }[] = [];
    const inserts: { text: string; moveId: unknown }[] = [];
    const moveRows = new Map<number, { old?: number; new?: number }>();
    const moveRow = (id: unknown, side: 'old' | 'new', lineNumber: number) => {
      if (id === undefined) return;
      if (!Number.isInteger(id) || (id as number) < 1) throw new Error('invalid move id');
      const entry = moveRows.get(id as number) ?? {};
      if (entry[side] !== undefined) throw new Error('move id used twice');
      entry[side] = lineNumber;
      moveRows.set(id as number, entry);
    };

    for (const row of rows) {
      if (!isObject(row)) return 'invalid row';
      if (row.kind === 'equal' && hasExactKeys(row, ['kind', 'old', 'new'])) {
        const oldLine = line(row.old, oldLineCount);
        const newLine = line(row.new, newLineCount);
        if (oldLine.line !== nextOld++ || newLine.line !== nextNew++) return 'lines not in order';
        if (key(oldLine.text) !== key(newLine.text)) return 'equal row with different lines';
        count(oldKeys, oldLine.text);
        count(newKeys, newLine.text);
        equal++;
      } else if (row.kind === 'delete' && hasExactKeys(row, ['kind', 'old'], ['moveId'])) {
        const oldLine = line(row.old, oldLineCount);
        if (oldLine.line !== nextOld++) return 'lines not in order';
        moveRow(row.moveId, 'old', oldLine.line);
        count(oldKeys, oldLine.text);
        deletes.push({ text: oldLine.text, moveId: row.moveId });
      } else if (row.kind === 'insert' && hasExactKeys(row, ['kind', 'new'], ['moveId'])) {
        const newLine = line(row.new, newLineCount);
        if (newLine.line !== nextNew++) return 'lines not in order';
        moveRow(row.moveId, 'new', newLine.line);
        count(newKeys, newLine.text);
        inserts.push({ text: newLine.text, moveId: row.moveId });
      } else {
        return 'invalid row';
      }
    }
    if (nextOld !== oldLineCount + 1 || nextNew !== newLineCount + 1) return 'lines missing';

    if (moves.length !== moveRows.size) return 'moves do not match rows';
    for (let index = 0; index < moves.length; index++) {
      const move = moves[index];
      if (!isObject(move) || !hasExactKeys(move, ['id', 'oldLine', 'newLine']) || move.id !== index + 1) return 'invalid move';
      const linked = moveRows.get(index + 1);
      if (!linked || linked.old !== move.oldLine || linked.new !== move.newLine) return 'move without its delete and insert';
      if (index > 0 && (move.oldLine as number) <= (moves[index - 1] as { oldLine: number }).oldLine) return 'move ids not in old-line order';
    }

    // Move rules (same as `detectMoves`): unique, non-blank, equal keys; every such delete/insert pair is linked
    const movable = (text: string) => !isBlankLine(text) && oldKeys.get(key(text)) === 1 && newKeys.get(key(text)) === 1;
    const insertOfKey = new Map(inserts.map((insert) => [key(insert.text), insert]));
    const insertOfMove = new Map(inserts.filter((insert) => insert.moveId !== undefined).map((insert) => [insert.moveId, insert]));
    for (const remove of deletes) {
      if (remove.moveId !== undefined) {
        // Both rows of the id exist (checked above)
        if (key(insertOfMove.get(remove.moveId)!.text) !== key(remove.text)) return 'move links different lines';
        if (!movable(remove.text)) return 'move of a blank or repeated line';
      } else if (movable(remove.text) && insertOfKey.has(key(remove.text))) {
        return 'unique moved line not linked as move';
      }
    }

    const moved = moves.length;
    const expectedStats = { unchanged: equal, removed: oldLineCount - equal - moved, added: newLineCount - equal - moved, moved };
    if (!isObject(stats) || !hasExactKeys(stats, Object.keys(expectedStats))) return 'invalid stats';
    for (const [name, value] of Object.entries(expectedStats)) if (stats[name] !== value) return `stats.${name} does not match`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid diff document';
  }
}

export const isDiffDocument = (value: unknown): value is DiffDocument => diffDocumentError(value) === null;

/**
 * Error if `document` is not the complete diff of exactly these input lines (counts, every original text, options),
 * or `null`. Detects partial or truncated results (e.g. a worker that dropped lines).
 */
export function diffInputMismatch(document: DiffDocument, oldLines: string[], newLines: string[], ignoreWhitespace: boolean): string | null {
  if (document.options.ignoreWhitespace !== ignoreWhitespace) return 'options do not match the request';
  if (document.oldLineCount !== oldLines.length || document.newLineCount !== newLines.length) return 'line counts do not match the input';
  for (const row of document.rows) {
    if (row.kind !== 'insert' && row.old.text !== oldLines[row.old.line - 1]) return 'old text does not match the input';
    if (row.kind !== 'delete' && row.new.text !== newLines[row.new.line - 1]) return 'new text does not match the input';
  }
  return null;
}
