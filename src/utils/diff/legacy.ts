// Transitional adapter (Paket 7, B1 -> B3): the current DiffPage still renders the old `DiffResult[]` list
// (`{ type, text, lineNumber }`). Removed in B3, when the page renders the `DiffDocument` directly.
//
// Known limits (documented, intentionally not hidden):
// - Moves are shown as removed + added (the old format cannot mark the source line); `stats.moved` counts them.
// - One line number per entry: removed = old line, unchanged/added = new line.
// - With ignoreWhitespace an unchanged entry shows the new text (old and new can differ in whitespace).
import type { DiffDocument } from './types';

export function toLegacyDiffResults(document: DiffDocument): DiffResult[] {
  return document.rows.map((row): DiffResult => {
    switch (row.kind) {
      case 'equal':
        return { type: 'unchanged', text: row.new.text, lineNumber: row.new.line };
      case 'delete':
        return { type: 'removed', text: row.old.text, lineNumber: row.old.line };
      case 'insert':
        return { type: 'added', text: row.new.text, lineNumber: row.new.line };
    }
  });
}
