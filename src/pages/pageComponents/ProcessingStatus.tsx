import { Activity, Cpu, Database, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBackendProcessor } from '../../hooks/useBackendProcessor';
import { useRuntimeSetting, setRuntimeSetting } from '../../hooks/useSettings';
import { useProcessingStore } from '../../hooks/useProcessingStore';
import './styles/ProcessingStatusStyle.css';

interface ProcessingStatusProps {
  onAbort?: () => void;
  progress?: number;
  error?: Error | null;
}

export function ProcessingStatus({ onAbort, progress, error }: ProcessingStatusProps) {
  const { t } = useTranslation();
  const { availableBackend, toggleMode } = useBackendProcessor();
  const mode = useRuntimeSetting('processingMode');
  const isProcessing = useProcessingStore((state) => state.isProcessing);
  const metrics = useProcessingStore((state) => state.metrics);

  const statusMessage =
    error?.message ??
    (isProcessing
      ? progress !== undefined
        ? `${t('processing.status.processing')} (${Math.round(progress)}%)`
        : t('processing.status.processing')
      : t('processing.status.ready'));

  return (
    <div className="processing-status">
      {isProcessing ? (
        <div className="status-group">
          {isProcessing && typeof onAbort === 'function' && (
            <button onClick={onAbort} className={`abort-button ${error ? 'error' : ''}`}>
              {error ? <XCircle size={16} /> : <Loader2 className="loading-spinner" size={16} />}
            </button>
          )}
          <span className={`status-message ${error ? 'error' : ''}`}>{statusMessage}</span>
        </div>
      ) : (
        <div className="status-group">
          <button onClick={toggleMode} className="mode-toggle" title={t(`processing.mode.${mode}`)}>
            {mode === 'backend' && availableBackend ? (
              <>
                <Database size={16} className="backend-icon" />
                <span className="backend-text">{t('processing.mode.backend')}</span>
              </>
            ) : (
              <>
                <Cpu size={16} className="fallback-icon" />
                <span className="fallback-text">{t('processing.mode.fallback')}</span>
              </>
            )}
          </button>

          {metrics && (
            <div className="metrics-group">
              <div title={t('processing.metrics.time.tooltip')} className="metric execution-time">
                <Activity size={14} />
                <span>{metrics.executionTime?.toFixed(2) ?? '0.00'}ms</span>
              </div>

              {mode === 'backend' && (metrics.memoryUsage ?? 0) > 0 && (
                <div title={t('processing.metrics.memory.tooltip')} className="metric memory-usage">
                  <Database size={14} />
                  <span>{((metrics.memoryUsage ?? 0) / 1024 / 1024).toLocaleString()} MB</span>
                </div>
              )}

              <div title={t('processing.metrics.size.tooltip')} className="metric data-size">
                <span className="input-size">↓ {((metrics.inputSize ?? 0) / 1024).toLocaleString()} KB</span>
                <span className="output-size">↑ {((metrics.outputSize ?? 0) / 1024).toLocaleString()} KB</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
