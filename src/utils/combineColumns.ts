// Combine of split columns (JS engine). Same rules as the Rust command `combine_columns` (text_processor.rs),
// shared fixtures: tests/fixtures/line-endings-cases.json (`combine`).
import { joinLines, type LineFormat } from './lines.ts';

export interface CombineColumn {
  /** Index of the split column */
  index: number;
  /** Placed before the value of this column (ignored for the first used column) */
  separator: string;
}

/**
 * Joins the used columns row by row. The row count is the longest used column; missing values are `''`, so leading
 * and trailing empty values keep their rows and the columns never shift against each other.
 * The rows are joined with `format`: the line format of the text that was split (see `lineFormatOf`).
 */
export function combineColumns(columns: readonly (readonly string[])[], used: readonly CombineColumn[], format: LineFormat): string {
  const rows = used.reduce((max, col) => Math.max(max, columns[col.index]?.length ?? 0), 0);
  const lines = Array.from({ length: rows }, (_, row) =>
    used.map((col, i) => (i === 0 ? '' : col.separator) + (columns[col.index]?.[row] ?? '')).join('')
  );
  return joinLines(lines, format);
}

/** Calls a Tauri command (`invokeUNSAFE`); rejects on a failed command or IPC call. */
export type InvokeCommand = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Combine state after appending `column` to `used`. `invoke = null` (JS mode) combines with `combineColumns`, otherwise
 * the Rust command `combine_columns` is called (same rules; only the used columns are sent). Every string is a valid
 * result, also `''` or a text equal to the previous one: the used columns change anyway. Rejects on a failed command
 * or a non-string answer, so the caller keeps its previous state.
 */
export async function appendCombineColumn(
  columns: readonly (readonly string[])[],
  used: readonly CombineColumn[],
  column: CombineColumn,
  format: LineFormat,
  invoke: InvokeCommand | null
): Promise<{ text: string; columns: CombineColumn[] }> {
  const newUsed = [...used, column];
  if (!invoke) return { text: combineColumns(columns, newUsed, format), columns: newUsed };

  const text = await invoke('combine_columns', {
    columns: newUsed.map((col) => columns[col.index] ?? []),
    used: newUsed.map((col, index) => ({ index, separator: col.separator })),
    lineending: format.lineEnding,
    trailingnewline: format.trailingNewline,
  });
  if (typeof text !== 'string') throw new Error(`combine_columns returned ${typeof text}`);
  return { text, columns: newUsed };
}
