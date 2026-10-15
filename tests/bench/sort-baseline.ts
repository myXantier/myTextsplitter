// Algorithm-only baseline of the current sort (Paket 9, Phase B), without React: `node tests/bench/sort-baseline.ts`
// Measures sortText (split + filter + sort + join) for 1k/10k/100k lines; the median of several runs, each on a fresh
// copy of the same seeded text. Not part of `npm test` (timings depend on the machine).
// Resolve hook for the extensionless app imports (sortLines -> ProcessingError), must come first
import '../unit/helpers/setup.ts';
import { makeSortText } from './sort-data.mjs';

const { sortText } = await import('../../src/utils/sortLines.ts');
const { splitLines, joinLines } = await import('../../src/utils/lines.ts');

const SIZES = [1_000, 10_000, 100_000];
const VARIANTS: [string, boolean][] = [
  ['alphabetical', true],
  ['alphabetical', false],
  ['natural', true],
  ['natural', false],
  ['lengthAsc', true],
  ['random', true],
];
const runsFor = (size: number) => (size >= 100_000 ? 3 : 7);

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(runs: number, fn: () => unknown): number {
  fn(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return median(times);
}

console.log(`Node ${process.version}, ICU ${process.versions.icu}, host locale ${new Intl.Collator().resolvedOptions().locale}`);
const rows: Record<string, string>[] = [];
for (const size of SIZES) {
  const text = makeSortText(size);
  const runs = runsFor(size);
  const row: Record<string, string> = { lines: String(size), chars: String(text.length) };
  row['split+join'] = measure(runs, () => joinLines(splitLines(text).lines, splitLines(text))).toFixed(1);
  for (const [method, caseSensitive] of VARIANTS) {
    row[`${method} ${caseSensitive ? 'CS' : 'CI'}`] = measure(runs, () => sortText(text, method as never, caseSensitive)).toFixed(1);
  }
  rows.push(row);
}
console.log('Median in ms:');
console.table(rows);
