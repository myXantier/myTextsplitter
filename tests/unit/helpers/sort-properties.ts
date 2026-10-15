// Reproducible helpers for the sort contract tests (Paket 9, Phase B): seeded random source, test data permutations,
// comparator laws and the chi-square statistic. Test infrastructure only; the production shuffle is not touched here.

/** Deterministic 32-bit generator (mulberry32): same seed, same sequence, values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform permutation of test data (Fisher-Yates) with the given random source; the input stays unchanged. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Expected order for a corpus of equivalence classes (classes in sort order, members with equal keys): the classes in
 * their order, the members of each class in their input order (stable sort).
 */
export function orderByClasses(classes: readonly (readonly string[])[], input: readonly string[]): string[] {
  const classOf = new Map<string, number>();
  classes.forEach((members, index) => members.forEach((line) => classOf.set(line, index)));
  return classes.flatMap((_, index) => input.filter((line) => classOf.get(line) === index));
}

/** Same lines with the same multiplicity, order ignored. */
export const sameMultiset = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export interface ComparatorLawViolations {
  /** sign(cmp(a, b)) !== -sign(cmp(b, a)) */
  antisymmetry: string[];
  /** a <= b and b <= c, but not a <= c (also: a == b, b == c, a != c) */
  transitivity: string[];
}

/** Checks antisymmetry and transitivity of a comparator on every pair and triple of the corpus. */
export function comparatorLawViolations(cmp: (a: string, b: string) => number, corpus: readonly string[]): ComparatorLawViolations {
  const sign = (a: string, b: string) => Math.sign(cmp(a, b));
  const result: ComparatorLawViolations = { antisymmetry: [], transitivity: [] };
  for (const a of corpus) {
    for (const b of corpus) {
      if (sign(a, b) !== -sign(b, a)) result.antisymmetry.push(`${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      for (const c of corpus) {
        const ab = sign(a, b);
        const bc = sign(b, c);
        const ac = sign(a, c);
        if (ab <= 0 && bc <= 0 && (ac > 0 || (ab === 0 && bc === 0 && ac !== 0))) {
          result.transitivity.push(`${JSON.stringify(a)} ${ab ? '<' : '='} ${JSON.stringify(b)} ${bc ? '<' : '='} ${JSON.stringify(c)}, but cmp(a, c) = ${ac}`);
        }
      }
    }
  }
  return result;
}

/** Pearson chi-square statistic of observed counts against equal expected frequencies. */
export function chiSquare(counts: readonly number[]): number {
  const total = counts.reduce((sum, n) => sum + n, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
}

/** Runs `fn` with `Math.random` replaced by a seeded generator (restored afterwards, also on errors). */
export function withSeededMathRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
