import { BaseWorker, ProcessOptions } from './BaseWorker';
import { validateRegexPattern } from '../utils/regex';
import { WorkerLogger } from '../other/Logger';

export class RemoveWorker extends BaseWorker {

  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Remove: Nachricht erhalten', options.args);

    try {
      const { mainParam, configParams } = options.args as RemoveConfig;
      const { caseSensitive, useRegex, trimParts, removeMode } = configParams;

      let processedLines: string[];

      if (removeMode === 'duplicates') {
        const seen = new Set<string>();
        processedLines = chunk.filter((line) => {
          const processedLine = trimParts ? line.trim() : line;
          const key = caseSensitive ? processedLine : processedLine.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else {
        let matcher: (line: string) => boolean;

        if (useRegex) {
          if (!validateRegexPattern(mainParam)) {
            self.postMessage({ success: false, error: 'Invalid regex pattern' });
            return this.convertToMyResult([]);
          }
          const regex = new RegExp(mainParam, caseSensitive ? '' : 'i');
          matcher = (line) => regex.test(line);
        } else {
          matcher = (line) => {
            const processedLine = caseSensitive ? line : line.toLowerCase();
            const processedPattern = caseSensitive ? mainParam : mainParam.toLowerCase();
            return processedLine.includes(processedPattern);
          };
        }

        if (removeMode === 'notContaining') {
          processedLines = chunk.filter((line) => matcher(line)); // Behalte nur ÜBEREINSTIMMUNG (nicht entfernen)
        } else {
          processedLines = chunk.filter((line) => !matcher(line)); // Entferne ÜBEREINSTIMMUNG (normaler Modus)
        }
      }

      return this.convertToMyResult<ProcessedText<string>>({
        result_text: processedLines.join('\n'), removed_lines: chunk.length - processedLines.length,
        metrics: {
          execution_time_ms: 0,
          memory_usage_kb: 0,
          memory_usage_str: ''
        }
      });
    } catch (error) {
      WorkerLogger.error('❌ Fehler im Worker:', error);
      return this.convertToMyResult<ProcessedText<string>>({
        result_text: '', removed_lines: 0,
        metrics: {
          execution_time_ms: 0,
          memory_usage_kb: 0,
          memory_usage_str: ''
        }
      });
    }
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(RemoveWorker);
