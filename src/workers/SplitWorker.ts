import { BaseWorker, ProcessOptions } from './BaseWorker';
import { WorkerLogger } from '../other/Logger';

export class SplitWorker extends BaseWorker {
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Split: Verarbeite Chunk –', chunk.length);

    try {
      const { mainParam, configParams } = options.args as SplitConfig;
      const { trimParts, useRegex } = configParams;
      WorkerLogger.debug(`🔍 Pattern: ${mainParam}, Trim: ${trimParts}`);

      const regex = useRegex ? new RegExp(mainParam, 'gm') : null;
      const columns: string[][] = [];

      chunk.forEach((line) => {
        // Verwende .split() mit einer Fallback-Leerzeile, falls `split()` am Ende nichts zurückgibt
        const parts = line.split(regex ?? mainParam).map(part => part ?? "");
        parts.forEach((part, index) => {
          if (!columns[index]) columns[index] = [];
          columns[index].push(trimParts ? part.trim() : part);
        });

        // Sicherstellen, dass alle Spalten gleich lang sind
        for (let i = parts.length; i < columns.length; i++) {
          columns[i].push(""); // Fehlende Werte mit "" auffüllen
        }
      });

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
