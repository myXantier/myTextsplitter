import { isBackend } from './Services';
import {
  ProcessingError,
  ERROR_KEYS,
  assertResult,
  isProcessingErrorKind,
  supersededError,
  toProcessingError,
  type ResultType,
} from './ProcessingError';
import { compileUserRegex } from '../utils/regex';

export type WorkerType = 'split' | 'diff' | 'filter' | 'remove' | 'preview';

interface myWorker extends Worker {
  cleanupTime: number;
  isWorking: boolean;
  /** Set by `terminateWorker`: a terminated worker never answers and must never be used again. */
  isTerminated?: boolean;
}

const workerConstructors = {
  split: () => new Worker(new URL('../workers/SplitWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
  diff: () => new Worker(new URL('../workers/DiffWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
  filter: () => new Worker(new URL('../workers/FilterWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
  remove: () => new Worker(new URL('../workers/RemoveWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
  preview: () => new Worker(new URL('../workers/MatchPreviewWorker.ts', import.meta.url), { type: 'module' }) as myWorker,
};

const WORKERS_SUPPORTED = typeof Worker !== 'undefined';

/** A started `invoke`. `cancel` stops it (worker jobs only) when a newer job of the same type starts. */
interface Job {
  id: number;
  cancel: () => void;
}

/** Result of a backend or worker run with its metrics; the metrics are only applied for the latest job. */
export interface JobOutcome {
  result: myResult;
  metrics: ProcessMetrics | null;
}

/** User regex of a job, compiled with the native JS engine (for the main-thread check). */
export interface JobRegex {
  pattern: string;
  flags: string;
}

export interface IBaseService {
  invoke(args: BaseConfig, tryBackend?: boolean): Promise<myResult>;
  isAvailable: () => Promise<boolean>;
  getMetrics(): ProcessMetrics | null;
}

export abstract class BaseService implements IBaseService {
  public static readonly ignoreWhitespaceRegex: RegExp = new RegExp('(?:^ {1,}| {2,}(?= \\S))', 'g');
  protected static workerPool: Map<WorkerType, myWorker[]> = new Map();

  /** Id of the latest started job per type: only its result is delivered (a late older result never overwrites it). */
  private static latestJobIds: Map<WorkerType, number> = new Map();
  /** Job per type that is still running (to cancel it when a newer one starts). */
  private static runningJobs: Map<WorkerType, Job> = new Map();
  private static jobCounter = 0;

  protected metrics: ProcessMetrics | null = null;
  protected lastMetrics: ProcessMetrics[] = [];
  protected type: WorkerType;
  /** Result type of this service; every result (backend, worker, main thread) is checked against it. */
  protected abstract readonly resultType: ResultType;

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

        // Pooled workers are idle; iterate over a copy because entries are removed
        for (const worker of [...workers]) {
          if (worker.isWorking === false && BaseService.workerIsIdleForTooLong(worker)) {
            window.logger.warn(`🛑 Worker (${type}) war zu lange untätig und wird entfernt.`);
            BaseService.terminateWorker(worker);
            workers.splice(workers.indexOf(worker), 1);
          }
        }
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
    // The preview runs while typing: a pattern that is too expensive is stopped early
    preview: 3_000,
  };

  /** Terminates all idle (pooled) workers; running jobs are not affected. */
  public static cleanupWorkers(): void {
    window.logger.debug('🧹 Bereinige alle Worker...');
    for (const [workerType, workers] of this.workerPool) {
      workers.forEach((worker) => BaseService.terminateWorker(worker));
      this.workerPool.set(workerType, []);
    }
  }

  /**
   * Stops the running job of `type`: a worker job is terminated, a backend job (cannot be stopped) has its late
   * result discarded. Its promise rejects as `superseded`.
   */
  public static cancelPending(type: WorkerType): void {
    BaseService.latestJobIds.set(type, ++BaseService.jobCounter);
    BaseService.runningJobs.get(type)?.cancel();
    BaseService.runningJobs.delete(type);
  }

  private static terminateWorker(worker: myWorker) {
    worker.isTerminated = true;
    worker.terminate();
  }

  /** Registers a new job of this type; a still running older job of the same type is cancelled. */
  private startJob(): Job {
    const job: Job = { id: ++BaseService.jobCounter, cancel: () => {} };
    BaseService.latestJobIds.set(this.type, job.id);
    BaseService.runningJobs.get(this.type)?.cancel();
    BaseService.runningJobs.set(this.type, job);
    return job;
  }

  private isLatestJob(job: Job): boolean {
    return BaseService.latestJobIds.get(this.type) === job.id;
  }

  private endJob(job: Job) {
    if (BaseService.runningJobs.get(this.type) === job) BaseService.runningJobs.delete(this.type);
  }

  /** Backend result with its metrics (applied by `invoke` only if the job is still the latest one). */
  protected backendOutcome(result: myResult, backendMetrics: BackendMetrics, input?: string, output?: string): JobOutcome {
    return { result, metrics: BaseService.toMetrics(backendMetrics.execution_time_ms, input ?? '', output ?? '', backendMetrics.memory_usage_kb) };
  }

  private static toMetrics(executTime: number, input: string, output: string, memoryUsage: number | null = 0): ProcessMetrics {
    const encoder = new TextEncoder();
    return {
      executionTime: executTime,
      memoryUsage: memoryUsage,
      inputSize: input ? encoder.encode(input).length : 0,
      outputSize: input ? encoder.encode(output).length : 0,
    };
  }

  private applyMetrics(newMetric: ProcessMetrics) {
    this.lastMetrics.push(newMetric);
    if (this.lastMetrics.length > 10) {
      this.lastMetrics.shift();
    }

    this.metrics = newMetric;
  }

  getMetrics(): ProcessMetrics | null {
    return this.metrics;
  }

  /**
   * Resolves with a result of `resultType` (validated at runtime, may be empty) or rejects with a
   * `ProcessingError`. There is no automatic fallback to another processing path: errors are reported as they are.
   *
   * Only the latest job per type is delivered: when a newer job of the same type starts, an older worker job is
   * terminated and an older backend job (Rust cannot be stopped) has its late result or error discarded; both
   * reject with `superseded`. Results and metrics of a superseded job are never applied.
   */
  async invoke(args: BaseConfig, tryBackend?: boolean): Promise<myResult> {
    const job = this.startJob();
    let inBackend = tryBackend ?? true;
    let outcome: JobOutcome;

    try {
      // Inside try/finally: a failing backend detection must not leave the job registered
      inBackend = tryBackend ?? (await this.isAvailable());
      if (!this.isLatestJob(job)) throw supersededError();
      if (inBackend) {
        window.logger.debug('BaseService.invokeBackend');
        outcome = await this.invokeBackend(args);
      } else if (WORKERS_SUPPORTED) {
        window.logger.debug('BaseService.frontendWithWorker');
        outcome = await this.frontendWithWorker(args, job);
      } else {
        window.logger.debug('BaseService.frontendInMainThread');
        this.assertMainThreadAllowed(args);
        outcome = { result: await this.frontendInMainThread(args), metrics: null };
      }
    } catch (error) {
      if (!this.isLatestJob(job)) throw supersededError();
      throw toProcessingError(error, inBackend ? 'backend' : 'worker');
    } finally {
      this.endJob(job);
    }

    if (!this.isLatestJob(job)) throw supersededError();
    const result = assertResult(outcome.result, this.resultType);
    if (outcome.metrics) this.applyMetrics(outcome.metrics);
    return result;
  }

  protected abstract invokeBackend(args: BaseConfig): Promise<JobOutcome>;

  /** The user regex this job executes in JS, or `null` if it runs none. */
  protected regexOf(_args: BaseConfig): JobRegex | null {
    return null;
  }

  /**
   * Without Web Worker the job would run in the UI thread, where a user regex cannot be stopped (a timer in the same
   * thread does not run while the regex runs). Such jobs are refused: an invalid pattern as `invalidRegex`
   * (compiling is safe), a valid one as `regexRequiresWorker`. Jobs without regex are not affected.
   */
  private assertMainThreadAllowed(args: BaseConfig) {
    const regex = this.regexOf(args);
    if (!regex) return;
    compileUserRegex(regex.pattern, regex.flags);
    throw new ProcessingError('worker', ERROR_KEYS.regexRequiresWorker, `${this.type}: no Web Worker available`);
  }

  private frontendWithWorker(args: BaseConfig, job: Job): Promise<JobOutcome> {
    return new Promise((resolve, reject) => {
      const pool = BaseService.workerPool.get(this.type)!;
      let worker: myWorker;
      try {
        worker = pool.pop() ?? workerConstructors[this.type]();
      } catch (error) {
        // e.g. blocked by a content security policy; no automatic main-thread fallback
        reject(toProcessingError(error, 'worker'));
        return;
      }
      worker.isWorking = true;
      window.logger.debug(`✅ Worker genutzt (${this.type}), Poolgröße: ${pool.length}`);

      let settled = false;
      let startTime = 0;

      /**
       * Ends the job exactly once: clears the timer and the handlers, then returns the worker to the pool (it finished
       * normally) or terminates it (timeout, crash, cancelled). Later messages of this worker can no longer arrive.
       */
      const finish = (reusable: boolean, outcome: JobOutcome | { error: ProcessingError }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        job.cancel = () => {};
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.isWorking = false;

        if (reusable && !worker.isTerminated) {
          worker.cleanupTime = Date.now();
          // Current pool, not `pool`: cleanupWorkers() may have replaced it meanwhile (the old array is orphaned)
          BaseService.workerPool.get(this.type)!.push(worker);
        } else {
          window.logger.warn(`🛑 Worker (${this.type}) wird beendet.`);
          BaseService.terminateWorker(worker);
        }

        if ('result' in outcome) resolve(outcome);
        else reject(outcome.error);
      };

      // `terminate()` stops a running regex in the worker thread (unlike a timer in the UI thread)
      const timeoutId = setTimeout(() => {
        window.logger.warn(`⏳ Timeout! Worker (${this.type}) antwortet nicht.`);
        finish(false, { error: new ProcessingError('timeout', ERROR_KEYS.timeout, `worker (${this.type}) did not answer`) });
      }, this.workerTimeouts[this.type]);

      job.cancel = () => finish(false, { error: supersededError() });

      worker.onmessage = (e) => {
        const data = e.data;
        // Only the message type is logged: results contain the user's text
        window.logger.debug(`💬 Worker-Antwort erhalten (${this.type}): ${data?.type}`);

        if (data?.type === 'progress') {
          window.logger.debug(`🔄 Fortschritt: ${data.progress}%`);
          return; // 🔥 Progress-Updates ignorieren
        }

        if (data?.success === true) {
          try {
            const result = assertResult(data.result, this.resultType);
            const metrics = BaseService.toMetrics(performance.now() - startTime, JSON.stringify(args), JSON.stringify(result));
            finish(true, { result, metrics });
          } catch (error) {
            finish(true, { error: toProcessingError(error, 'invalidResult') });
          }
        } else if (data?.success === false) {
          // Errors thrown as `ProcessingError` in the worker keep their kind and message key
          finish(true, {
            error: isProcessingErrorKind(data.errorKind)
              ? new ProcessingError(data.errorKind, String(data.error), data.errorDetail)
              : new ProcessingError('worker', ERROR_KEYS.general, typeof data.error === 'string' ? data.error : undefined),
          });
        } else {
          finish(true, { error: new ProcessingError('invalidResult', ERROR_KEYS.general, `unexpected worker message (${this.type})`) });
        }
      };

      worker.onerror = (e) => {
        finish(false, { error: new ProcessingError('worker', ERROR_KEYS.general, e.message || 'Worker error') });
      };

      worker.onmessageerror = () => {
        finish(false, { error: new ProcessingError('worker', ERROR_KEYS.general, `worker message could not be read (${this.type})`) });
      };

      try {
        startTime = performance.now();
        window.logger.debug(`📤 Sende Nachricht an Worker (${this.type})`);
        worker.postMessage({ args });
      } catch (error) {
        finish(false, { error: toProcessingError(error, 'worker') });
      }
    });
  }

  protected abstract frontendInMainThread(args: BaseConfig): Promise<myResult>;

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
