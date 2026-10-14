import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { compileUserRegex } from '../utils/regex';
import { WorkerLogger } from '../other/Logger';
import { createResult } from '../services/ProcessingError';
import { joinLines } from '../utils/lines';

export class FilterWorker extends BaseWorker {
  /** Errors are thrown and reported by `BaseWorker.process` (never turned into an empty result). */
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Filter: Verarbeite Chunk –', chunk.length);

    const { mainParam, configParams } = options.args as FilterConfig;
    const { caseSensitive, filterMode, splitMatches } = configParams;

    const regex = compileUserRegex(mainParam, caseSensitive ? 'g' : 'gi');

    const processedLines = chunk
      .map((line) => {
        if (!line.trim()) return ''; // Verhindert, dass leere Zeilen erhalten bleiben

        if (filterMode === 'remove') {
          return line.replace(regex, '');
        } else {
          const matches = [...line.matchAll(regex)].map((m) => m[0]);
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
