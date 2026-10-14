import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { computeLinearDiffFromArray, getWordDiffs } from '../utils/diff';
import { WorkerLogger } from '../other/Logger';
import { createResult } from '../services/ProcessingError';
import { splitLines } from '../utils/lines';

export class DiffWorker extends BaseWorker {
  private currentIndex = 0;

  // TEST
  public process(options: ProcessOptions): void {
    // Reset vor jedem neuen Job
    this.helperArray = [];
    this.currentIndex = 0;
    super.process(options);
  }

  /** Errors are thrown and reported by `BaseWorker.process` (never turned into an empty result). */
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    WorkerLogger.debug('📩 Worker-Diff: Verarbeite Chunk –', chunk.length);

    const { mainParam, configParams } = options.args as DiffConfig;
    const { ignoreWhitespace } = configParams;

    if (this.helperArray.length === 0) {
      // Same line model as the old text (`chunk`): line endings are not compared, a trailing newline adds no line
      this.helperArray = splitLines(ignoreWhitespace ? mainParam.replace(/(?:^ {1,}| {2,}(?= \S))/g, '') : mainParam).lines;
      this.currentIndex = 0;
    }

    WorkerLogger.debug(`🔍 Diff-Prozess, Ignore Whitespace: ${ignoreWhitespace}`);

    const newLines = this.helperArray.slice(this.currentIndex, this.currentIndex + chunk.length);
    this.currentIndex += chunk.length;
    const oldLines = ignoreWhitespace 
      ? chunk.map(line => line.replace(/(?:^ {1,}| {2,}(?= \S))/g, ''))
      : chunk;

    // Compute basic diff results
    const diffResults = computeLinearDiffFromArray(oldLines, newLines);

    return createResult('Text', JSON.stringify(diffResults));
  }
}

BaseWorker.setupWorker(DiffWorker);
