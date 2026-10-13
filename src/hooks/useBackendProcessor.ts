import { useState, useEffect, useCallback } from 'react';
import { useProcessingState } from './useProcessingState';
import { SplitService, DiffService, FilterService, RemoveService, isBackend } from '../services/Services';
import { BaseService } from '../services/BaseService';
import { logProcessingError, toProcessingError } from '../services/ProcessingError';
import { useTextBuffer } from './useTextBuffer';
import { useRuntimeSetting, setRuntimeSetting } from '../hooks/useSettings';

export function useBackendProcessor() {
  const [availableBackend, setAvailableBackend] = useState(false);
  const { setProcessing, setError, setMetrics } = useProcessingState();
  const processingMode = useRuntimeSetting('processingMode');

  // Backend-Verfügbarkeit prüfen & globalen Mode setzen
  useEffect(() => {
    const checkBackend = async () => {
      const isAvailableBackend = await isBackend();
      setAvailableBackend(isAvailableBackend);
    };
    checkBackend();
  }, []);

  const toggleMode = () => {
    if (availableBackend) {
      const newMode: processModes = (processingMode === 'fallback') ? 'backend' : 'fallback';
      if (newMode === 'fallback') {
        window.logger.warn('⚠️ Wechsel auf Fallback, 🧹 beende alle Worker...');
        BaseService.cleanupWorkers();
      }

      setRuntimeSetting('processingMode', newMode);
    }
    else setRuntimeSetting('processingMode', 'fallback');
  };

  const { saveToBuffer } = useTextBuffer();

  /**
   * Resolves with the validated result or rejects with a `ProcessingError` (logged here once, without the input
   * text; the calling page shows the message). On failure the buffer and the metrics keep the last successful result.
   */
  const executeProcessing = useCallback(async (serviceInstance: BaseService, args: BaseConfig) => {
    setProcessing(true);
    setError(null);

    const runInBackend = processingMode === 'backend';

    try {
      const result = await serviceInstance.invoke(args, runInBackend);
      setMetrics(serviceInstance.getMetrics());

      setProcessing(false);

      if (result.type === 'Text') {
        saveToBuffer(result.result);
      } else if (result.type === 'Column') {
        saveToBuffer(result.result.join('\n'));
      } else if (result.type === 'ColumnList') {
        saveToBuffer(result.result.join('\n'));
      } else if (result.type === 'TextV2') {
        saveToBuffer(result.result.result_text);
      }

      return result;
    } catch (err) {
      const error = toProcessingError(err, runInBackend ? 'backend' : 'worker');
      logProcessingError('Verarbeitung fehlgeschlagen', error);
      // setProcessing(false) also resets the error state, so the error is set afterwards
      setProcessing(false);
      setError(error);
      throw error;
    }
  }, [saveToBuffer, setProcessing, setMetrics, setError, processingMode]);

  return {
    splitText: (args: SplitConfig) => executeProcessing(new SplitService(), args),
    diffText: (args: DiffConfig) => executeProcessing(new DiffService(), args),
    filterText: (args: FilterConfig) => executeProcessing(new FilterService(), args),
    removeLines: (args: RemoveConfig) => executeProcessing(new RemoveService(), args),
    availableBackend,
    toggleMode,
  };
}
