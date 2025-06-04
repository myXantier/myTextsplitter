import { useState, useEffect, useCallback } from 'react';
import { useProcessingState } from './useProcessingState';
import { SplitService, DiffService, FilterService, RemoveService, isBackend } from '../services/Services';
import { BaseService } from '../services/BaseService';
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

  const { saveToBuffer, clearBuffer } = useTextBuffer();

  const executeProcessing = useCallback(async (serviceInstance: BaseService, args: BaseConfig) => {
    setProcessing(true);
    setError(null);
    clearBuffer();

    const runInBackend = processingMode === 'backend';

    try {
      const result = await serviceInstance.invoke(args, runInBackend);
      setMetrics(serviceInstance.getMetrics());

      setProcessing(false);

      if (result.type === 'Text') {
        window.logger.debug('[useBackendProcessor]-MEINS-Text resul: ', result);
        saveToBuffer(result.result);
      } else if (result.type === 'Column') {
        window.logger.debug('[useBackendProcessor]-MEINS-Column resul: ', result);
        saveToBuffer(result.result?.join('\n'));
      } else if (result.type === 'ColumnList') {
        window.logger.debug('[useBackendProcessor]-MEINS-ColumnList resul: ', result);
        saveToBuffer(result.result?.join('\n'));
      } else if (result.type === 'TextV2') {
        window.logger.debug('[useBackendProcessor]-MEINS-TextV2 resul: ', result);
        saveToBuffer(result.result?.result_text);
      }

      return result;
    } catch (err) {
      setError(err as Error);
      window.logger.error('❌ Fehler bei Verarbeitung:', err);
      setProcessing(false);
      throw err;
    }
  }, [saveToBuffer, clearBuffer, setProcessing, setMetrics, setError, processingMode]);

  return {
    splitText: (args: SplitConfig) => executeProcessing(new SplitService(), args),
    diffText: (args: DiffConfig) => executeProcessing(new DiffService(), args),
    filterText: (args: FilterConfig) => executeProcessing(new FilterService(), args),
    removeLines: (args: RemoveConfig) => executeProcessing(new RemoveService(), args),
    availableBackend,
    toggleMode,
  };
}
