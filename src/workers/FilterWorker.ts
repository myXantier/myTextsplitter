import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { compileUserRegex, hasSurrogates, matchesWithoutCutCharacters } from '../utils/regex';
import { WorkerLogger } from '../other/Logger';
import { createResult } from '../services/ProcessingError';
import { joinLines } from '../utils/lines';
import { isBlankLine } from '../utils/diff/whitespace';
import { assertFilterMode } from '../utils/textModes';

export class FilterWorker extends BaseWorker {
  /** Errors are thrown and reported by `BaseWorker.process` (never turned into an empty result). */
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Filter: Verarbeite Chunk –', chunk.length);

    const { mainParam, configParams } = options.args as FilterConfig;
    const { caseSensitive, filterMode, splitMatches } = configParams;

    assertFilterMode(filterMode); // before the regex, like Rust
    const regex = compileUserRegex(mainParam, caseSensitive ? 'g' : 'gi');

    // `null` = the line is dropped; an empty string is a kept empty line
    const processedLines = chunk
      .map((line): string | null => {
        // Without surrogates no character can be cut: the checks only run for lines that contain one
        const surrogates = hasSurrogates(line);

        if (filterMode === 'remove') {
          // The check runs through all matches first (keeping no match list), so a cut character fails before any
          // result exists; `replace` then removes exactly the same matches. A removed match must not leave half a character.
          if (surrogates) for (const _ of matchesWithoutCutCharacters(line, regex, true));
          const rest = line.replace(regex, '');
          // Paket 8 C2: only a line from which a match actually removed text may disappear, and only if the rest is
          // blank (Unicode White_Space, same as Rust). A line without removed text (no match, only zero-width matches)
          // stays unchanged, also an empty or whitespace-only line. Removing text always shortens the line.
          if (rest === line) return line;
          return isBlankLine(rest) ? null : rest;
        } else {
          // Blank = only Unicode White_Space, same set as Rust `str::trim` (not `String.trim`)
          if (isBlankLine(line)) return null; // Verhindert, dass leere Zeilen erhalten bleiben
          // Split matches are separated by line breaks: there a cut character can never be joined again.
          // The loop consumes the whole check before the matches are used. Without surrogates the native `match`
          // returns the same match texts as `matchAll` (also empty ones) without match objects.
          let matches: string[];
          if (surrogates) {
            matches = [];
            for (const match of matchesWithoutCutCharacters(line, regex, !splitMatches)) matches.push(match[0]);
          } else {
            matches = line.match(regex) ?? [];
          }
          // No match, or only zero-width matches (joined text empty): the line is dropped
          const kept = splitMatches ? matches.join(this.lineFormat.lineEnding) : matches.join('');
          return kept || null;
        }
      })
      .filter((line): line is string => line !== null);

    // Line ending and trailing newline of the input; no remaining line gives ''
    return createResult('Text', joinLines(processedLines, this.lineFormat));
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(FilterWorker);
