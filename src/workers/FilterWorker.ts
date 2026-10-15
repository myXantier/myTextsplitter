import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { compileUserRegex, hasSurrogates, matchesWithoutCutCharacters } from '../utils/regex';
import { WorkerLogger } from '../other/Logger';
import { createResult } from '../services/ProcessingError';
import { joinLines } from '../utils/lines';
import { isBlankLine } from '../utils/diff/whitespace';

export class FilterWorker extends BaseWorker {
  /** Errors are thrown and reported by `BaseWorker.process` (never turned into an empty result). */
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Filter: Verarbeite Chunk –', chunk.length);

    const { mainParam, configParams } = options.args as FilterConfig;
    const { caseSensitive, filterMode, splitMatches } = configParams;

    const regex = compileUserRegex(mainParam, caseSensitive ? 'g' : 'gi');

    const processedLines = chunk
      .map((line) => {
        // Blank = only Unicode White_Space, same set as Rust `str::trim` (not `String.trim`)
        if (isBlankLine(line)) return ''; // Verhindert, dass leere Zeilen erhalten bleiben

        // Without surrogates no character can be cut: the checks only run for lines that contain one
        const surrogates = hasSurrogates(line);

        if (filterMode === 'remove') {
          // The check runs through all matches first (keeping no match list), so a cut character fails before any
          // result exists; `replace` then removes exactly the same matches. A removed match must not leave half a character.
          if (surrogates) for (const _ of matchesWithoutCutCharacters(line, regex, true));
          return line.replace(regex, '');
        } else {
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
          if (!matches.length) return ''; // Gibt eine leere Zeile zurück
          return splitMatches ? matches.join(this.lineFormat.lineEnding) : matches.join('');
        }
      })
      .filter(Boolean);

    // Line ending and trailing newline of the input; no remaining line gives ''
    return createResult('Text', joinLines(processedLines, this.lineFormat));
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(FilterWorker);
