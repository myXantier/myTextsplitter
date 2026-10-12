import { BaseWorker, ProcessOptions } from './BaseWorker';
import { WorkerLogger } from '../other/Logger';
import { splitLinesToColumns } from '../utils/splitColumns';

export class SplitWorker extends BaseWorker {
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Split: Verarbeite Chunk –', chunk.length);

    try {
      const { mainParam, configParams } = options.args as SplitConfig;
      const { trimParts, keepEmptyLines } = configParams;
      WorkerLogger.debug(`🔍 Pattern: ${mainParam}, Trim: ${trimParts}, Keep empty lines: ${keepEmptyLines}`);

      // `chunk` is always the complete text (BaseWorker.process), so rows are never split across chunks
      const columns = splitLinesToColumns(chunk, mainParam, configParams);

      WorkerLogger.debug('🔹 Finales Spalten-Array:', columns);
      return this.convertToMyResult(columns);
    } catch (error) {

      WorkerLogger.error('❌ Fehler im Worker:', error);
      return this.convertToMyResult([]);
    }
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(SplitWorker);
