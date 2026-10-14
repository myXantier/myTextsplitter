import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { compileUserRegex } from '../utils/regex';
import { WorkerLogger } from '../other/Logger';
import { createResult } from '../services/ProcessingError';

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
          return splitMatches ? matches.join('\n') : matches.join('');
        }
      })
      .filter(Boolean);

    return createResult('Text', processedLines.join('\n'));
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(FilterWorker);
