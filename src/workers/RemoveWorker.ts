import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { compileUserRegex } from '../utils/regex';
import { WorkerLogger } from '../other/Logger';
import { createResult } from '../services/ProcessingError';
import { joinLines } from '../utils/lines';
import { trimWhitespace } from '../utils/diff/whitespace';

export class RemoveWorker extends BaseWorker {

  /** Errors are thrown and reported by `BaseWorker.process` (never turned into an empty result). */
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Remove: Verarbeite Chunk –', chunk.length);

    const { mainParam, configParams } = options.args as RemoveConfig;
    const { caseSensitive, useRegex, trimParts, removeMode } = configParams;

    let processedLines: string[];

    if (removeMode === 'duplicates') {
      const seen = new Set<string>();
      processedLines = chunk.filter((line) => {
        // Trim (Unicode White_Space, same as Rust) and case only change the key; the original line is kept
        const processedLine = trimParts ? trimWhitespace(line) : line;
        const key = caseSensitive ? processedLine : processedLine.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else {
      let matcher: (line: string) => boolean;

      if (useRegex) {
        const regex = compileUserRegex(mainParam, caseSensitive ? '' : 'i');
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

    return createResult('TextV2', {
      // Line ending and trailing newline of the input; no remaining line gives ''
      result_text: joinLines(processedLines, this.lineFormat), removed_lines: chunk.length - processedLines.length,
      metrics: {
        execution_time_ms: 0,
        memory_usage_kb: 0,
        memory_usage_str: ''
      }
    });
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(RemoveWorker);
