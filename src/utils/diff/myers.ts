// Line alignment for the diff: Myers' O((N+M)·D) algorithm in its linear-space variant (middle snake + divide and
// conquer), ported 1:1 to Rust (`src-tauri/src/diff/myers.rs`). Both versions must stay step-for-step identical:
// the shared fixtures (`tests/fixtures/diff-cases.json`) check the exact result in both engines.
//
// Input: two sequences of key ids (equal ids = equal comparison keys). Output: the matched index pairs (ascending)
// of a longest common subsequence. Tie-break, i.e. which of several optimal alignments is returned:
//
// 1. Ids that occur in only one sequence can never match and are removed first (does not change the LCS).
// 2. Common prefix and suffix are matched directly, then Myers' bisection runs on the rest (forward and reverse
//    search, diagonals in ascending order, first overlap wins; on a tie the forward search prefers the step that
//    has already advanced further in the old sequence).
// 3. Normalization "earliest match": every matched pair (i, j) is moved to the first index i' > previous i with
//    the same id and the first j' > previous j with the same id. The number of matches stays the same; of several
//    equal lines, the earliest ones are paired and the later ones become deletes/inserts (`A A A B` -> `A A B`
//    deletes the third `A`).
//
// The order of deletes and inserts between two matches is decided by the caller (`lineDiff.ts`).

/**
 * Upper bound of the work units of one diff (diagonals visited plus snake steps of the bisection). Deterministic
 * (counted, not timed) and the same in Rust and JS, so both engines accept and reject the same inputs. Prefix,
 * suffix and lines that occur on one side only cost nothing, so texts that are mostly equal or completely different
 * are never limited; the limit applies to many reordered common lines.
 */
export const DIFF_WORK_LIMIT = 100_000_000;

/** Thrown when an alignment needs more than `DIFF_WORK_LIMIT` work units. No partial result is returned. */
export class DiffLimitError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`diff needs more than ${limit} work units`);
    this.name = 'DiffLimitError';
    this.limit = limit;
  }
}

/** Matched pairs as two parallel arrays (old index, new index), ascending, and the work units spent (<= limit). */
export interface Matches {
  old: number[];
  new: number[];
  work: number;
}

export function alignSequences(a: ArrayLike<number>, b: ArrayLike<number>, idCount: number, limit = DIFF_WORK_LIMIT): Matches {
  // 1. Only ids present on both sides can match
  const inA = new Uint8Array(idCount);
  const inB = new Uint8Array(idCount);
  for (let i = 0; i < a.length; i++) inA[a[i]] = 1;
  for (let j = 0; j < b.length; j++) inB[b[j]] = 1;
  const aIndex: number[] = [];
  const bIndex: number[] = [];
  for (let i = 0; i < a.length; i++) if (inB[a[i]]) aIndex.push(i);
  for (let j = 0; j < b.length; j++) if (inA[b[j]]) bIndex.push(j);
  const ra = Int32Array.from(aIndex, (i) => a[i]);
  const rb = Int32Array.from(bIndex, (j) => b[j]);

  // 2. Myers on the reduced sequences
  const myers = new Myers(ra, rb, limit);
  myers.diff(0, ra.length, 0, rb.length);

  // 3. Back to the original indices, then "earliest match"
  const matches: Matches = { old: [], new: [], work: myers.work };
  let prevA = -1;
  let prevB = -1;
  for (let m = 0; m < myers.matchA.length; m++) {
    const i = aIndex[myers.matchA[m]];
    const j = bIndex[myers.matchB[m]];
    let ei = prevA + 1;
    while (a[ei] !== a[i]) ei++;
    let ej = prevB + 1;
    while (b[ej] !== b[j]) ej++;
    matches.old.push(ei);
    matches.new.push(ej);
    prevA = ei;
    prevB = ej;
  }
  return matches;
}

class Myers {
  readonly matchA: number[] = [];
  readonly matchB: number[] = [];
  private readonly a: Int32Array;
  private readonly b: Int32Array;
  private readonly limit: number;
  /** Work units spent so far */
  work = 0;

  constructor(a: Int32Array, b: Int32Array, limit: number) {
    this.a = a;
    this.b = b;
    this.limit = limit;
  }

  private spend(units: number) {
    this.work += units;
    if (this.work > this.limit) throw new DiffLimitError(this.limit);
  }

  /** Appends the matches of `a[aLo..aHi]` / `b[bLo..bHi]` in ascending order. */
  diff(aLo: number, aHi: number, bLo: number, bHi: number): void {
    const { a, b } = this;
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      this.matchA.push(aLo++);
      this.matchB.push(bLo++);
    }
    let aEnd = aHi;
    let bEnd = bHi;
    while (aEnd > aLo && bEnd > bLo && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aLo < aEnd && bLo < bEnd) {
      const split = this.bisect(aLo, aEnd, bLo, bEnd);
      if (split) {
        this.diff(aLo, split[0], bLo, split[1]);
        this.diff(split[0], aEnd, split[1], bEnd);
      }
    }
    for (let k = 0; k < aHi - aEnd; k++) {
      this.matchA.push(aEnd + k);
      this.matchB.push(bEnd + k);
    }
  }

  /**
   * Middle snake of the range (both sides non-empty, first and last elements differ). Returns the absolute split
   * point on an optimal path, or `null` if the range has no common element.
   */
  private bisect(aLo: number, aHi: number, bLo: number, bHi: number): [number, number] | null {
    const { a, b } = this;
    const n = aHi - aLo;
    const m = bHi - bLo;
    const maxD = Math.ceil((n + m) / 2);
    const offset = maxD;
    const size = 2 * maxD + 2;
    const v1 = new Int32Array(size).fill(-1);
    const v2 = new Int32Array(size).fill(-1);
    v1[offset + 1] = 0;
    v2[offset + 1] = 0;
    const delta = n - m;
    const front = (delta & 1) !== 0;
    let k1start = 0;
    let k1end = 0;
    let k2start = 0;
    let k2end = 0;

    for (let d = 0; d < maxD; d++) {
      for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
        const k1o = offset + k1;
        let x1 = k1 === -d || (k1 !== d && v1[k1o - 1] < v1[k1o + 1]) ? v1[k1o + 1] : v1[k1o - 1] + 1;
        let y1 = x1 - k1;
        const x1start = x1;
        while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
          x1++;
          y1++;
        }
        this.spend(1 + x1 - x1start);
        v1[k1o] = x1;
        if (x1 > n) {
          k1end += 2;
        } else if (y1 > m) {
          k1start += 2;
        } else if (front) {
          const k2o = offset + delta - k1;
          if (k2o >= 0 && k2o < size && v2[k2o] !== -1 && x1 >= n - v2[k2o]) return [aLo + x1, bLo + y1];
        }
      }

      for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
        const k2o = offset + k2;
        let x2 = k2 === -d || (k2 !== d && v2[k2o - 1] < v2[k2o + 1]) ? v2[k2o + 1] : v2[k2o - 1] + 1;
        let y2 = x2 - k2;
        const x2start = x2;
        while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) {
          x2++;
          y2++;
        }
        this.spend(1 + x2 - x2start);
        v2[k2o] = x2;
        if (x2 > n) {
          k2end += 2;
        } else if (y2 > m) {
          k2start += 2;
        } else if (!front) {
          const k1o = offset + delta - k2;
          if (k1o >= 0 && k1o < size && v1[k1o] !== -1) {
            const x1 = v1[k1o];
            const y1 = offset + x1 - k1o;
            if (x1 >= n - x2) return [aLo + x1, bLo + y1];
          }
        }
      }
    }
    return null;
  }
}
