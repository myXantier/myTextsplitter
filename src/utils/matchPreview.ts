// Match segments of the Filter pattern preview (MatchPreviewWorker). Kept free of app imports (`npm test`).

/**
 * One row per line with at least one non-empty match: `[text, match, text, match, ..., text]`
 * (even indexes = text between the matches, odd indexes = matches; text segments may be empty).
 * Zero-width matches are not highlighted. `regex` must have the `g` flag.
 */
export function findMatchSegments(lines: string[], regex: RegExp): string[][] {
  const rows: string[][] = [];

  for (const line of lines) {
    const segments: string[] = [];
    let lastIndex = 0;

    for (const match of line.matchAll(regex)) {
      if (!match[0]) continue;
      segments.push(line.slice(lastIndex, match.index), match[0]);
      lastIndex = match.index + match[0].length;
    }

    if (segments.length) {
      segments.push(line.slice(lastIndex));
      rows.push(segments);
    }
  }

  return rows;
}
