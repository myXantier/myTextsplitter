//! Line alignment for the diff: Myers' O((N+M)·D) algorithm in its linear-space variant (middle snake + divide and
//! conquer). Step-for-step port of `src/utils/diff/myers.ts`; both must stay identical (shared fixtures
//! `tests/fixtures/diff-cases.json`). The tie-break is documented there:
//!
//! 1. ids that occur in only one sequence are removed first (they can never match);
//! 2. common prefix/suffix, then bisection (forward and reverse search, ascending diagonals, first overlap wins);
//! 3. normalization "earliest match": every pair moves to the first equal element after the previous pair.

/// Upper bound of the work units of one diff (diagonals visited plus snake steps). Same value and counting as in JS.
pub const DIFF_WORK_LIMIT: u64 = 100_000_000;

/// The alignment needs more than `limit` work units; no partial result exists.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffLimitExceeded {
    pub limit: u64,
}

/// Matched index pairs (old, new), ascending, and the work units spent (<= limit).
pub struct Matches {
    pub old: Vec<usize>,
    pub new: Vec<usize>,
    /// Read by the word diff (`intraline.rs`) for its budget
    pub work: u64,
}

pub fn align_sequences(a: &[u32], b: &[u32], id_count: usize, limit: u64) -> Result<Matches, DiffLimitExceeded> {
    // 1. Only ids present on both sides can match
    let mut in_a = vec![false; id_count];
    let mut in_b = vec![false; id_count];
    for &id in a {
        in_a[id as usize] = true;
    }
    for &id in b {
        in_b[id as usize] = true;
    }
    let a_index: Vec<usize> = (0..a.len()).filter(|&i| in_b[a[i] as usize]).collect();
    let b_index: Vec<usize> = (0..b.len()).filter(|&j| in_a[b[j] as usize]).collect();

    // 2. Myers on the reduced sequences
    let mut myers = Myers {
        a: a_index.iter().map(|&i| a[i]).collect(),
        b: b_index.iter().map(|&j| b[j]).collect(),
        match_a: Vec::new(),
        match_b: Vec::new(),
        work: 0,
        limit,
    };
    let (n, m) = (myers.a.len(), myers.b.len());
    myers.diff(0, n, 0, m)?;

    // 3. Back to the original indices, then "earliest match"
    let mut matches = Matches { old: Vec::with_capacity(myers.match_a.len()), new: Vec::with_capacity(myers.match_a.len()), work: myers.work };
    let (mut next_a, mut next_b) = (0usize, 0usize);
    for (&ma, &mb) in myers.match_a.iter().zip(&myers.match_b) {
        let (i, j) = (a_index[ma], b_index[mb]);
        let mut ei = next_a;
        while a[ei] != a[i] {
            ei += 1;
        }
        let mut ej = next_b;
        while b[ej] != b[j] {
            ej += 1;
        }
        matches.old.push(ei);
        matches.new.push(ej);
        next_a = ei + 1;
        next_b = ej + 1;
    }
    Ok(matches)
}

struct Myers {
    a: Vec<u32>,
    b: Vec<u32>,
    match_a: Vec<usize>,
    match_b: Vec<usize>,
    work: u64,
    limit: u64,
}

impl Myers {
    fn spend(&mut self, units: u64) -> Result<(), DiffLimitExceeded> {
        self.work += units;
        if self.work > self.limit {
            return Err(DiffLimitExceeded { limit: self.limit });
        }
        Ok(())
    }

    /// Appends the matches of `a[a_lo..a_hi]` / `b[b_lo..b_hi]` in ascending order.
    fn diff(&mut self, mut a_lo: usize, a_hi: usize, mut b_lo: usize, b_hi: usize) -> Result<(), DiffLimitExceeded> {
        while a_lo < a_hi && b_lo < b_hi && self.a[a_lo] == self.b[b_lo] {
            self.match_a.push(a_lo);
            self.match_b.push(b_lo);
            a_lo += 1;
            b_lo += 1;
        }
        let (mut a_end, mut b_end) = (a_hi, b_hi);
        while a_end > a_lo && b_end > b_lo && self.a[a_end - 1] == self.b[b_end - 1] {
            a_end -= 1;
            b_end -= 1;
        }
        if a_lo < a_end && b_lo < b_end {
            if let Some((x, y)) = self.bisect(a_lo, a_end, b_lo, b_end)? {
                self.diff(a_lo, x, b_lo, y)?;
                self.diff(x, a_end, y, b_end)?;
            }
        }
        for k in 0..a_hi - a_end {
            self.match_a.push(a_end + k);
            self.match_b.push(b_end + k);
        }
        Ok(())
    }

    /// Middle snake of the range (both sides non-empty, first and last elements differ). Returns the absolute split
    /// point on an optimal path, or `None` if the range has no common element.
    fn bisect(&mut self, a_lo: usize, a_hi: usize, b_lo: usize, b_hi: usize) -> Result<Option<(usize, usize)>, DiffLimitExceeded> {
        let n = (a_hi - a_lo) as isize;
        let m = (b_hi - b_lo) as isize;
        let max_d = (n + m + 1) / 2;
        let offset = max_d;
        let size = 2 * max_d + 2;
        let mut v1 = vec![-1isize; size as usize];
        let mut v2 = vec![-1isize; size as usize];
        v1[(offset + 1) as usize] = 0;
        v2[(offset + 1) as usize] = 0;
        let delta = n - m;
        let front = (delta & 1) != 0;
        let (mut k1start, mut k1end, mut k2start, mut k2end) = (0isize, 0isize, 0isize, 0isize);
        let at_a = |x: isize| a_lo + x as usize;
        let at_b = |y: isize| b_lo + y as usize;

        for d in 0..max_d {
            let mut k1 = -d + k1start;
            while k1 <= d - k1end {
                let k1o = (offset + k1) as usize;
                let mut x1 = if k1 == -d || (k1 != d && v1[k1o - 1] < v1[k1o + 1]) { v1[k1o + 1] } else { v1[k1o - 1] + 1 };
                let mut y1 = x1 - k1;
                let x1start = x1;
                while x1 < n && y1 < m && self.a[at_a(x1)] == self.b[at_b(y1)] {
                    x1 += 1;
                    y1 += 1;
                }
                self.spend(1 + (x1 - x1start) as u64)?;
                v1[k1o] = x1;
                if x1 > n {
                    k1end += 2;
                } else if y1 > m {
                    k1start += 2;
                } else if front {
                    let k2o = offset + delta - k1;
                    if k2o >= 0 && k2o < size && v2[k2o as usize] != -1 && x1 >= n - v2[k2o as usize] {
                        return Ok(Some((at_a(x1), at_b(y1))));
                    }
                }
                k1 += 2;
            }

            let mut k2 = -d + k2start;
            while k2 <= d - k2end {
                let k2o = (offset + k2) as usize;
                let mut x2 = if k2 == -d || (k2 != d && v2[k2o - 1] < v2[k2o + 1]) { v2[k2o + 1] } else { v2[k2o - 1] + 1 };
                let mut y2 = x2 - k2;
                let x2start = x2;
                while x2 < n && y2 < m && self.a[a_hi - x2 as usize - 1] == self.b[b_hi - y2 as usize - 1] {
                    x2 += 1;
                    y2 += 1;
                }
                self.spend(1 + (x2 - x2start) as u64)?;
                v2[k2o] = x2;
                if x2 > n {
                    k2end += 2;
                } else if y2 > m {
                    k2start += 2;
                } else if !front {
                    let k1o = offset + delta - k2;
                    if k1o >= 0 && k1o < size && v1[k1o as usize] != -1 {
                        let x1 = v1[k1o as usize];
                        let y1 = offset + x1 - k1o;
                        if x1 >= n - x2 {
                            return Ok(Some((at_a(x1), at_b(y1))));
                        }
                    }
                }
                k2 += 2;
            }
        }
        Ok(None)
    }
}
