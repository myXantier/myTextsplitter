import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { WorkerLogger } from '../other/Logger';
import { SplitInputError, splitLinesToColumns } from '../utils/splitColumns';
import { createResult, emptyDelimiterError, invalidRegexError, regexSplitsCharacterError } from '../services/ProcessingError';

export class SplitWorker extends BaseWorker {
  /** Errors are thrown and reported by `BaseWorker.process` (never turned into an empty result). */
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Split: Verarbeite Chunk –', chunk.length);

    const { configParams } = options.args as SplitConfig;
    const { trimParts, keepEmptyLines } = configParams;
    WorkerLogger.debug(`🔍 Trim: ${trimParts}, Keep empty lines: ${keepEmptyLines}`);

    try {
      // `chunk` is always the complete text (BaseWorker.process), so rows are never split across chunks
      const columns = splitLinesToColumns(chunk, options.args.mainParam, configParams);
      return createResult('ColumnList', columns);
    } catch (error) {
      // `splitLinesToColumns` throws a SyntaxError for an invalid regex and a SplitInputError for an empty plain
      // delimiter or a cut character (Paket 10 E4/E5); no partial columns are returned
      if (configParams.useRegex && error instanceof SyntaxError) throw invalidRegexError(error.message);
      if (error instanceof SplitInputError) throw error.reason === 'emptyDelimiter' ? emptyDelimiterError() : regexSplitsCharacterError();
      throw error;
    }
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(SplitWorker);
