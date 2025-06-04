import { BaseWorker, ProcessOptions } from './BaseWorker';
import { validateRegexPattern } from '../utils/regex';
import { WorkerLogger } from '../other/Logger';

export class FilterWorker extends BaseWorker {
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Filter: Nachricht erhalten', options.args);

    try {
      const { mainParam, configParams } = options.args as FilterConfig;
      const { caseSensitive, filterMode, splitMatches } = configParams;

      if (!validateRegexPattern(mainParam)) {
        throw new Error('errors.invalidRegex');
      }

      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(mainParam, flags);

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

      return this.convertToMyResult(processedLines.join('\n'));
    } catch (error) {
      WorkerLogger.error('❌ Fehler im Worker:', error);
      return this.convertToMyResult([]);
    }
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(FilterWorker);
