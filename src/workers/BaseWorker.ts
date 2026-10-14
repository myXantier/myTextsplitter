import { WorkerLogger } from "../other/Logger";
import { ERROR_KEYS, ProcessingError, createResult } from "../services/ProcessingError";
import { DEFAULT_LINE_FORMAT, splitLines, type LineFormat } from "../utils/lines";

export interface ProcessOptions {
  args: BaseConfig;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface WorkerMessage {
  type: 'start' | 'progress' | 'complete' | 'error';
  data?: any;
  error?: string;
  progress?: number;
  metrics?: {
    executionTime: number;
    memoryUsage: number;
    inputSize: number;
    outputSize: number;
  };
}

export abstract class BaseWorker {
  protected startTime: number = 0;
  protected aborted: boolean = false;
  protected helperArray: string[] = [];
  /** Line format of the current `sourceText`; results that are texts are joined with it (`joinLines`). */
  protected lineFormat: LineFormat = DEFAULT_LINE_FORMAT;

  // Abstrakte Methode für Worker-spezifische Verarbeitung
  protected abstract processChunk(chunk: string[], options: ProcessOptions): myResult; //string | string[];

  protected process(options: ProcessOptions): void {
    this.startTime = performance.now();
    this.aborted = false;

    if (!options || !options.args) {
      WorkerLogger.error('❌ Worker-Fehler: `options.args` ist `undefined`!', options);
      self.postMessage({
        success: false,
        type: 'error',
        error: ERROR_KEYS.general,
        errorKind: 'worker',
        errorDetail: '`options.args` is missing',
        result: null,
      });
      return;
    }

    try {
      const { sourceText } = options.args;
      // Shared line model: no extra line for a trailing newline, terminators (also CRLF/CR) are not part of a line
      const { lines, lineEnding, trailingNewline } = splitLines(sourceText);
      this.lineFormat = { lineEnding, trailingNewline };

      if (options.args as SplitConfig) {
        const result = this.processChunk(lines, options);
        // Finale Antwort mit `success: true`
        self.postMessage({
          success: true,
          type: 'complete',
          result: result,
          metrics: this.getMetrics(sourceText, JSON.stringify(result.result)), // Speichergröße anpassen
        });
      } else {
        const chunkSize = 10;
        const totalChunks = Math.ceil(lines.length / chunkSize);
        let processedLines: string[] = [];
        let removedLines: number = 0;

        WorkerLogger.debug(`🚀 Starte Verarbeitung mit ${totalChunks} Chunks`);

        for (let i = 0; i < lines.length; i += chunkSize) {
          if (this.aborted) {
            WorkerLogger.warn('⚠ Verarbeitung vom Benutzer abgebrochen.');
            return;
          }

          const chunk = lines.slice(i, i + chunkSize);
          const processedChunk = this.processChunk(chunk, options);

          
          switch (processedChunk.type) {
            case 'Text':
              processedLines.push(processedChunk.result);
              break;
            case 'TextV2':
              // processedLines.push(...processedChunk.result.result_text.split('\n'));
              processedLines.push(processedChunk.result.result_text);
              removedLines += processedChunk.result.removed_lines;
              break;
            case 'Column':
              processedLines.push(...processedChunk.result);
              break;
            case 'ColumnList':
              processedChunk.result.forEach((col) => {
                if (col.length) processedLines.push(...col);
              });
              break;
            default:
              WorkerLogger.error('❌ [BaseWorker.process] Unerwarteter Rückgabewert von splitText:', processedChunk);
          }

          // processedLines.push(...(Array.isArray(processedChunk.result) ? (processedChunk as myResultColumn).result : (processedChunk as myResultText).result.split('\n')));

          const progress = Math.min(100, ((i + chunkSize) / lines.length) * 100);
          if (options.onProgress) {
            options.onProgress(progress);
          }

          // **Fortschritt senden (ohne `success`, da es sich nur um Progress handelt)**
          self.postMessage({
            type: 'progress',
            progress,
            metrics: this.getMetrics(sourceText, processedLines.join('\n')),
          });
        }


        this.helperArray = [];

        const isRemoveConfig =
        options.args &&
        "configParams" in options.args &&
        (options.args as RemoveConfig).configParams.removeMode;

        WorkerLogger.debug("isRemoveConfig: ", isRemoveConfig);
        const metri = this.getMetrics(sourceText, JSON.stringify(processedLines.join("\n")));
        // No placeholder text: an empty result is a valid result
        const finalResultText = processedLines.join("\n");

        const result = isRemoveConfig
            ? createResult("TextV2", {
                  result_text: finalResultText,
                  removed_lines: removedLines,
                  metrics: { execution_time_ms: metri.executionTime, memory_usage_kb: metri.memoryUsage, memory_usage_str: "" },
              })
            : createResult("Column", processedLines);

        // Finale Antwort mit `success: true`
        self.postMessage({
          success: true,
          type: 'complete',
          result: result,
          metrics: this.getMetrics(sourceText, JSON.stringify(result.result)), // Speichergröße anpassen
        });
      }
    } catch (error) {
      // A `ProcessingError` (e.g. invalid regex) keeps its kind and message key; anything else is a worker error
      const isProcessingError = error instanceof ProcessingError;
      self.postMessage({
        success: false,
        type: 'error',
        error: isProcessingError ? error.message : ERROR_KEYS.general,
        errorKind: isProcessingError ? error.kind : 'worker',
        errorDetail: isProcessingError ? error.detail : error instanceof Error ? error.message : String(error),
        result: null,
      });
    }
  }

  protected getMetrics(input: string, output: string) {
    return {
      executionTime: performance.now() - this.startTime,
      memoryUsage: 0,
      inputSize: new Blob([input]).size,
      outputSize: new Blob([output]).size,
    };
  }

  public abort() {
    this.aborted = true;
  }

  public static setupWorker<T extends BaseWorker>(WorkerClass: new () => T) {
    const workerInstance = new WorkerClass();

    self.onmessage = (event: MessageEvent) => {
      // The message content is not logged: it contains the user's text
      WorkerLogger.debug('📩 Worker empfängt Nachricht');

      // Verhindere Fehler durch `{ test: true }`
      if (!event.data.args) {
        if (event.data.test) {
          WorkerLogger.warn('🟡 Test-Nachricht erhalten, ignoriere sie:', event.data);
          return; // Test-Nachricht ignorieren
        }
        WorkerLogger.error('❌ Worker-Fehler: `args` fehlt in der Nachricht!');
        self.postMessage({
          success: false,
          type: 'error',
          error: ERROR_KEYS.general,
          errorKind: 'worker',
          errorDetail: '`args` fehlt in der Nachricht!',
          result: null,
        });
        return;
      }

      workerInstance.process(event.data as ProcessOptions);
    };
  }
}
