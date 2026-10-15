// Reproducible input for the sort baselines (Paket 9, Phase B): same text for the same (count, seed), in Node and in the
// browser (served by Vite as /tests/bench/sort-data.mjs). Plain JS without imports.
// Mix: German words with umlauts and ß, mixed case, embedded and standalone (also negative/decimal) numbers,
// file-name-like lines, about 2 % blank lines and a few duplicates.

const WORDS = ['Apfel', 'äpfel', 'Zebra', 'straße', 'Öl', 'über', 'Datei', 'kapitel', 'Version', 'Wert', 'zeile', 'Ärger', 'Mus', 'mus'];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` lines joined with LF (no trailing newline). */
export function makeSortText(count, seed = 9) {
  const random = mulberry32(seed);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const int = (max) => Math.floor(random() * max);
  const lines = [];
  for (let i = 0; i < count; i++) {
    const kind = random();
    if (kind < 0.02) lines.push(random() < 0.5 ? '' : '  ');
    else if (kind < 0.05 && lines.length) lines.push(lines[int(lines.length)]);
    else if (kind < 0.25) lines.push(`${pick(WORDS)}-${int(1000)}.txt`);
    else if (kind < 0.40) lines.push(`${random() < 0.3 ? '-' : ''}${int(10000)}.${int(100)}`);
    else if (kind < 0.55) lines.push(`v${int(3)}.${int(20)}.${int(20)}`);
    else lines.push(`${pick(WORDS)} ${pick(WORDS).toLowerCase()} ${int(100000)} ${pick(WORDS)}`);
  }
  return lines.join('\n');
}
