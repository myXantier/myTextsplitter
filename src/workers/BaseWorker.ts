import { WorkerLogger } from "../other/Logger";

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
        error: '`options.args` is missing',
        result: null,
      });
      return;
    }

    try {
      const { sourceText } = options.args;
      const lines = sourceText.split('\n');

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
        const finalResultText = processedLines.length > 0 ? processedLines.join("\n") : "[Keine Daten verarbeitet]";

        const result = isRemoveConfig
            ? this.convertToMyResult({
                  result_text: finalResultText,
                  removed_lines: removedLines,
                  metrics: { execution_time_ms: metri.executionTime, memory_usage_kb: metri.memoryUsage, memory_usage_str: "" },
              })
            : this.convertToMyResult(processedLines);

            WorkerLogger.debug("📩 Finales Ergebnis:", result);

        // Finale Antwort mit `success: true`
        self.postMessage({
          success: true,
          type: 'complete',
          result: result,
          metrics: this.getMetrics(sourceText, JSON.stringify(result.result)), // Speichergröße anpassen
        });
      }
    } catch (error) {
      self.postMessage({
        success: false,
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
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

  protected convertToMyResult<T extends AllowedResultTypes>(data: T): MyResultType<T> {
    const isNull = !data || (Array.isArray(data) && data.length === 0);
    let type: MyResultType<T> = "Text";

    if (Array.isArray(data)) {
        type = Array.isArray(data[0]) ? "ColumnList" : "Column";
    } else if (typeof data === "object" && "result_text" in data) {
        type = "TextV2"; // Falls es das verbesserte Text-Format ist
    }

    return {
        type,
        result: data,
        isNull,
        abort: false,
        __brand: "myResult",
    } as MyResultType<T>;
}

  public static setupWorker<T extends BaseWorker>(WorkerClass: new () => T) {
    const workerInstance = new WorkerClass();

    self.onmessage = (event: MessageEvent) => {
      WorkerLogger.debug('📩 Worker empfängt Nachricht:', event.data);

      // Verhindere Fehler durch `{ test: true }`
      if (!event.data.args) {
        if (event.data.test) {
          WorkerLogger.warn('🟡 Test-Nachricht erhalten, ignoriere sie:', event.data);
          return; // Test-Nachricht ignorieren
        }
        WorkerLogger.error('❌ Worker-Fehler: `args` fehlt in der Nachricht!', event.data);
        self.postMessage({
          success: false,
          type: 'error',
          error: '`args` fehlt in der Nachricht!',
          result: null,
        });
        return;
      }

      workerInstance.process(event.data as ProcessOptions);
    };
  }
}
