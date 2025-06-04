import { Undo2, Redo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProcessingStatus } from './ProcessingStatus';
import CopyButton from '../../components/CopyButton';
import { fontSizeToIconSize } from '../../utils/helper';
import { useSettings, usePermanentSetting, useRuntimeSetting, setRuntimeSetting } from '../../hooks/useSettings';
import { useCombineHistoryStore } from '../../hooks/useCombineHistoryStore';
import './styles/ResultCombineStyle.css';

export function CombineColumns() {
  const { t } = useTranslation();
  const fontSize = usePermanentSetting('fontSize');
  const combineSeparator = useRuntimeSetting('combineSeparator');

  const canUndo = useCombineHistoryStore((state) => state.canUndo());
  const undoCombine = useCombineHistoryStore((state) => state.undoCombine);
  const canRedo = useCombineHistoryStore((state) => state.canRedo());
  const redoCombine = useCombineHistoryStore((state) => state.redoCombine);
  const combinedText = useCombineHistoryStore((state) => state.getText());
  const clearCombineState = useCombineHistoryStore((state) => state.clearCombineState);

  return (
    <div className="combine-container">
      <div className="combine-header">
        <h2 className="combine-title">{t('combine.title')}</h2>
        <ProcessingStatus />
      </div>

      <div className="combine-result-box">
        <div className="combine-result-toolbar">
          <div className="combine-result-toolbar-start">
            <label className="combine-label">{t('combine.separator')}</label>
            <input
              type="text"
              value={combineSeparator}
              onChange={(e) => setRuntimeSetting('combineSeparator', e.target.value)}
              className="combine-input"
              placeholder="e.g. :"
            />
          </div>
          <div className="combine-result-toolbar-end">
            <button
              onClick={undoCombine}
              className={`combine-action ${!canUndo ? 'disabled' : ''}`}
              disabled={!canUndo}
              title={t('actions.undo')}
            >
              <Undo2 size={fontSizeToIconSize[fontSize]} />
            </button>
            <button
              onClick={redoCombine}
              className={`combine-action ${!canRedo ? 'disabled' : ''}`}
              disabled={!canRedo}
              title={t('actions.redo')}
            >
              <Redo2 size={fontSizeToIconSize[fontSize]} />
            </button>
            <button onClick={clearCombineState} className="combine-clear">
              {t('actions.clear')}
            </button>
            <CopyButton toCopy={combinedText} />
          </div>
        </div>
        <textarea
          value={combinedText}
          readOnly
          className="combine-textarea"
          placeholder="Click column buttons above to combine text..."
        />
      </div>
    </div>
  );
}
