import { BaseWorker, ProcessOptions } from './BaseWorker';
import { computeLinearDiffFromArray, getWordDiffs } from '../utils/diff';
import { WorkerLogger } from '../other/Logger';

export class DiffWorker extends BaseWorker {
  private currentIndex = 0;

  // TEST
  public process(options: ProcessOptions): void {
    // Reset vor jedem neuen Job
    this.helperArray = [];
    this.currentIndex = 0;
    super.process(options);
  }

  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Diff: Nachricht erhalten', options.args);

    try {
      const { mainParam, configParams } = options.args as DiffConfig;
      const { ignoreWhitespace } = configParams;

      if (this.helperArray.length === 0) {
        this.helperArray = ignoreWhitespace 
          ? mainParam.replace(/(?:^ {1,}| {2,}(?= \S))/g, '').split('\n') 
          : mainParam.split('\n');
        this.currentIndex = 0;
      }

      WorkerLogger.debug(`🔍 Diff-Prozess mit Pattern: ${mainParam}, Ignore Whitespace: ${ignoreWhitespace}`);

      const newLines = this.helperArray.slice(this.currentIndex, this.currentIndex + chunk.length);
      this.currentIndex += chunk.length;
      const oldLines = ignoreWhitespace 
        ? chunk.map(line => line.replace(/(?:^ {1,}| {2,}(?= \S))/g, ''))
        : chunk;

      // Compute basic diff results
      const diffResults = computeLinearDiffFromArray(oldLines, newLines);

      return this.convertToMyResult(JSON.stringify(diffResults));
    } catch (error) {
      WorkerLogger.error('❌ Fehler im Worker:', error);
      return this.convertToMyResult('');
    }
  }
}

BaseWorker.setupWorker(DiffWorker);
