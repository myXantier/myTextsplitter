import { BaseService } from './BaseService';

export class SplitService extends BaseService {
  constructor() {
    super('split');
  }

  protected async invokeBackend(args: SplitConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { trimParts, useRegex } = configParams;
    const { invokeUNSAFE } = await import('./tauriInvoke'); // ✅ Lazy import
    
    const result = await invokeUNSAFE<ProcessedText<string[]>>('process_text_block', { text: sourceText, delimiter: mainParam, trimparts: trimParts, useregex: useRegex });
    window.logger.debug("SplitService.invokeUNSAFE Result: ", result);

    if (result.result_text) {
      this.setMetrics(result.metrics);
      return this.convertToMyResult(result.result_text.map((c) => c.split('\n')));
    }

    window.logger.error("[invokeBackend] konnte nicht erfolgreich ausgeführt werden.");
    return this.convertToMyResult([]);
  }

  protected async frontendInMainThread(args: SplitConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { trimParts, useRegex } = configParams;
    const lines = sourceText.split('\n');
    const columns: string[][] = [];

    try {
      const regex = useRegex ? new RegExp(mainParam, 'gm') : null;

      lines.forEach((line) => {
        // Verwende .split() mit einer Fallback-Leerzeile, falls `split()` am Ende nichts zurückgibt
        const parts = line.split(regex ?? mainParam).map(part => part ?? "");
        parts.forEach((part, index) => {
          if (!columns[index]) columns[index] = [];
          columns[index].push(trimParts ? part.trim() : part);
        });

        // ** Sicherstellen, dass alle Spalten gleich lang sind**
        for (let i = parts.length; i < columns.length; i++) {
          columns[i].push(""); // Fehlende Werte mit "" auffüllen
        }
      });

      return this.convertToMyResult(columns);
    } catch (error) {
      window.logger.error((error as Error).message);
      return this.convertToMyResult([]);
    }
  }
}
