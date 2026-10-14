// Sort of the Sort page (JS only, there is no Rust implementation). Shared line fixtures: tests/fixtures/line-endings-cases.json
import natsort from './sortNatural.ts';
import { joinLines, splitLines } from './lines.ts';

export type SortMethod = 'alphabetical' | 'alphabeticalReverse' | 'natural' | 'naturalReverse' | 'lengthAsc' | 'lengthDesc' | 'random';

/**
 * Sorts the data lines of `text`. Empty and whitespace-only lines are dropped (existing behaviour). The result keeps
 * the line ending and the trailing newline of the input (shared line model); no remaining line gives `''`.
 */
export function sortText(text: string, sortMethod: SortMethod, caseSensitive: boolean): string {
  const { lines: allLines, ...format } = splitLines(text);
  const lines = allLines.filter(line => line.trim() !== '');
  let sortedLines: string[];

  switch (sortMethod) {
    case 'alphabetical':
      sortedLines = lines.sort((a, b) =>
        caseSensitive ? a.localeCompare(b) : a.toLowerCase().localeCompare(b.toLowerCase())
      );
      break;

    case 'alphabeticalReverse':
      sortedLines = lines.sort((a, b) =>
        caseSensitive ? b.localeCompare(a) : b.toLowerCase().localeCompare(a.toLowerCase())
      );
      break;

    case 'natural':
      sortedLines = lines.sort(natsort({ insensitive: !caseSensitive }));
      break;

    case 'naturalReverse':
      sortedLines = lines.sort(natsort({ insensitive: !caseSensitive, desc: true }));
      break;

    case 'lengthAsc':
      sortedLines = lines.sort((a, b) => a.length - b.length);
      break;

    case 'lengthDesc':
      sortedLines = lines.sort((a, b) => b.length - a.length);
      break;

    case 'random':
      sortedLines = lines.sort(() => Math.random() - 0.5);
      break;

    default:
      sortedLines = lines;
  }

  return joinLines(sortedLines, format);
}
