import { isBackend } from './Services';

export type WorkerType = 'split' | 'diff' | 'filter' | 'remove';

interface myWorker extends Worker {
  cleanupTime: number;
  isWorking: boolean;
}

const workerConstructors = {
  split: () => new Worker(new URL('../workers/SplitWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
  diff: () => new Worker(new URL('../workers/DiffWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
  filter: () => new Worker(new URL('../workers/FilterWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
  remove: () => new Worker(new URL('../workers/RemoveWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
};

const WORKERS_SUPPORTED = typeof Worker !== 'undefined';

export interface IBaseService {
  invoke(args: BaseConfig, tryBackend?: boolean): Promise<myResult>;
  isAvailable: () => Promise<boolean>;
  getMetrics(): ProcessMetrics | null;
}

export abstract class BaseService implements IBaseService {
  public static readonly ignoreWhitespaceRegex: RegExp = new RegExp('(?:^ {1,}| {2,}(?= \\S))', 'g');
  protected static workerPool: Map<WorkerType, myWorker[]> = new Map();

  protected metrics: ProcessMetrics | null = null;
  protected lastMetrics: ProcessMetrics[] = [];
  protected type: WorkerType;

  constructor(type: WorkerType) {
    this.type = type;

    if (!BaseService.workerPool.has(type)) {
      BaseService.workerPool.set(type, []);
    }

    if (!BaseService.cleanupIntervalStarted) {
      BaseService.startWorkerCleanup();
      BaseService.cleanupIntervalStarted = true;
    }
  }

  private static cleanupIntervalStarted = false;

  private static startWorkerCleanup() {
    setInterval(() => {
      for (const [type, workers] of BaseService.workerPool.entries()) {
        window.logger.debug(`🛠 Aktueller Pool (${type}): ${workers.length} Worker`);

        workers.forEach((worker, index) => {
          if (worker.isWorking === false && BaseService.workerIsIdleForTooLong(worker)) {
            window.logger.warn(`🛑 Worker ${index} (${type}) war zu lange untätig und wird entfernt.`);
            worker.terminate();
            workers.splice(index, 1);
          }
        });
      }
    }, 10_000);
  }

  private static workerIsIdleForTooLong(worker: myWorker): boolean {
    return Date.now() - worker.cleanupTime > 60_000;
  }

  private workerTimeouts = {
    split: 10_000,
    diff: 15_000,
    filter: 10_000,
    remove: 12_000,
  };

  public static cleanupWorkers(): void {
    window.logger.debug('🧹 Bereinige alle Worker...');
    for (const [workerType, workers] of this.workerPool) {
      workers.forEach((worker) => worker.terminate());
      this.workerPool.set(workerType, []);
    }
  }

  protected setMetrics(backendMetrics: BackendMetrics, input?: string, output?: string) {
    this.updateMetrics(backendMetrics.execution_time_ms, input ?? '', output ?? '', backendMetrics.memory_usage_kb);
  }

  protected updateMetrics(executTime: number, input: string, output: string, memoryUsage = 0) {
    const encoder = new TextEncoder();
    const newMetric: ProcessMetrics = {
      executionTime: executTime,
      memoryUsage: memoryUsage,
      inputSize: input ? encoder.encode(input).length : 0,
      outputSize: input ? encoder.encode(output).length : 0,
    };

    this.lastMetrics.push(newMetric);
    if (this.lastMetrics.length > 10) {
      this.lastMetrics.shift();
    }

    this.metrics = newMetric;
  }

  getMetrics(): ProcessMetrics | null {
    return this.metrics;
  }

  async invoke(args: BaseConfig, tryBackend?: boolean): Promise<myResult> {
    // debugger;

    const inBackend = tryBackend ?? (await this.isAvailable());
    if (inBackend) {
      window.logger.debug('BaseService.invokeBackend');
      return await this.invokeBackend(args);
    } else {
      if (WORKERS_SUPPORTED) {
        window.logger.debug('BaseService.frontendWithWorker');
        return await this.frontendWithWorker(args);
      }
      window.logger.debug('BaseService.frontendInMainThread');
      return await this.frontendInMainThread(args);
    }
  }

  protected abstract invokeBackend(args: BaseConfig): Promise<myResult>;

  private async frontendWithWorker(args: BaseConfig): Promise<myResult> {
    return new Promise((resolve, reject) => {
      const pool = BaseService.workerPool.get(this.type)!;
      const worker = pool.pop() || workerConstructors[this.type]();

      if (!(worker instanceof Worker)) {
        throw new Error(`Worker-Instanz für ${this.type} konnte nicht erstellt werden!`);
      }
      worker.isWorking = true;

      // worker.cleanupTime = Date.now() + 60_000;
      window.logger.debug(`✅ Worker genutzt (${this.type}), Poolgröße: ${pool.length}`);

      let timeoutId = setTimeout(() => {
        window.logger.warn(`⏳ Timeout! Worker (${this.type}) antwortet nicht.`);
        cleanup(false);
        reject(new Error('Processing timeout'));
      }, this.workerTimeouts[this.type]);

      const cleanup = (reuse = true) => {
        setTimeout(() => {
          worker.onmessage = null;
          worker.onerror = null;
          worker.isWorking = false;
          if (reuse && workerIsActive(worker)) {
            pool.push(worker);
          } else {
            window.logger.warn(`🛑 Worker (${this.type}) wird beendet.`);
            worker.terminate();
          }
        }, 500);
      };

      function workerIsActive(worker: Worker): boolean {
        try {
          worker.postMessage({ test: true });
          return true;
        } catch {
          return false;
        }
      }

      let startTime = 0;

      worker.onmessage = async (e) => {
        window.logger.debug('💬 Worker-Antwort erhalten:', e.data);

        if (e.data.type === 'progress') {
          window.logger.debug(`🔄 Fortschritt: ${e.data.progress}%`);
          return; // 🔥 Progress-Updates ignorieren
        }

        clearTimeout(timeoutId);
        cleanup();

        if (e.data.success) {
          if (e.data.result && e.data.result.type) {
            // Wenn ein myResult zurückkommt, korrekt parsen
            this.updateMetrics(performance.now() - startTime, JSON.stringify(args), JSON.stringify(e.data.result));
            resolve(e.data.result);
          } else {
            reject(new Error(`Ungültiger Rückgabetyp (${e.data.result.type}) von Worker`));
          }
        } else {
          reject(new Error(e.data.error || 'errors.processingError'));
        }
      };

      worker.onerror = async (e) => {
        window.logger.error('❌ Worker-Fehler:', e);
        clearTimeout(timeoutId);
        cleanup(false);
        reject(new Error(e.message || 'Worker error'));
      };

      try {
        startTime = performance.now();
        window.logger.debug('📤 Sende Nachricht an Worker:', args); // 🛠 Debugging: Zeigt, was genau geschickt wird
        worker.postMessage({ args });
      } catch (error) {
        cleanup(false);
        reject(error instanceof Error ? error : new Error('Failed to start processing'));
      }
    });
  }

  protected abstract frontendInMainThread(args: BaseConfig): Promise<myResult>;
  
  protected convertToMyResult<T extends AllowedResultTypes>(data: T): MyResultType<T> {
    const isNull = !data || (Array.isArray(data) && data.length === 0);

    return {
      type: Array.isArray(data) ? (Array.isArray(data[0]) ? 'ColumnList' : 'Column') : 'Text',
      result: data,
      isNull,
      abort: false,
      __brand: 'myResult',
    } as MyResultType<T>;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const isAvailable = await isBackend();
      window.logger.debug('✅ Backend verfügbar:', isAvailable);
      return isAvailable;
    } catch (error) {
      window.logger.error('❌ Fehler beim Abrufen der Backend-Verfügbarkeit:', error);
      return false;
    }
  }
}
