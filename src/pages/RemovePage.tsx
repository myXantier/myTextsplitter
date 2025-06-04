import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Trash2 } from 'lucide-react';
import InputText from '../components/InputText';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import CopyButton from '../components/CopyButton';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import useSnackbar from '../hooks/useSnackbar';
import './styles/RemovePageStyle.css';

interface RemovePageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  visible: boolean;
}

export default function RemovePage({ sourceText, setSourceText, visible }: RemovePageProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const [showResult, setShowResult] = useState(false);
  const [resultText, setResultText] = useState('');
  const [options, setOptions] = useState({
    trim: true,
    caseSensitive: true,
    useRegex: false,
    pattern: '',
  });
  const [removedLines, setRemovedLines] = useState(0);
  const { removeLines } = useBackendProcessor();

  // File handling
  const handleFileAccepted = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => setSourceText(e.target?.result as string);
      reader.onerror = () => snackbar.error(t('notifications.readError'));
      reader.readAsText(file);
    },
    [t, setSourceText]
  );

  const { isDragging, dragHandlers } = useDragAndDrop({
    onFileAccepted: handleFileAccepted,
    onError: (message) => snackbar.error(message),
  });

  // Process text - remove lines
  const handleRemoveLines = useCallback(
    async (removeMode: string) => {
      if (!sourceText) {
        snackbar.error(t('errors.textRequired'));
        return;
      }

      if (removeMode !== 'duplicates' && !options.pattern) {
        snackbar.error(t('removeLines.enterPattern'));
        return;
      }

      try {
        const result = await removeLines({
          sourceText: sourceText,
          mainParam: options.pattern,
          configParams: {
            caseSensitive: options.caseSensitive,
            useRegex: options.useRegex,
            trimParts: options.trim,
            removeMode: removeMode,
          },
        });

        const convertedRes = window.myResultConverter<ProcessedText<string>>(result);
        
        if (convertedRes.status === 'ok') {
          setResultText(convertedRes.data.result_text);
          setRemovedLines(convertedRes.data.removed_lines);
          setShowResult(true);
          snackbar.success(t('removeLines.processed', { removed: convertedRes.data.removed_lines }));
        } else {
          throw convertedRes.error;
        }
      } catch (error) {
        window.logger.error('Error removing lines:', error);
        snackbar.error(t('errors.processingError'));
      }
    },
    [sourceText, options, removeLines, t]
  );

  return (
    <div className={`remove-lines app-container-column ${visible ? '' : 'hide-page'}`}>
      <ScrollableContainer>
        <section className="app-section flex-1">
          <div className="title">
            <span className="left">{t('removeLines.sourceText')}</span>
            <div className="reset-button">
              <IconRoundedButton
                highlightIcon={true}
                size="18px"
                radius="6px"
                svgIcon={<SvgIconReload size="16" />}
                colorDefault="transparent"
                title="Reset text"
                onClick={() => setSourceText('')}
              />
            </div>
            <OpenFileButton setFileText={setSourceText} />
          </div>
          <div className="content2 flex-column">
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              {...dragHandlers}
              className={`${isDragging ? 'border-2 border-dashed border-blue-500' : ''}`}
              placeholder={t('removeLines.sourcePlaceholder')}
            />
          </div>
        </section>

        <section className="app-section">
          <div className="title">
            <span className="left">REMOVE OPTIONS</span>
            <span className="right">Configure how the lines should be removed</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <Checkbox
                  label={t('removeLines.options.trim')}
                  checked={options.trim}
                  onChange={(val) => setOptions((prev) => ({ ...prev, trim: val }))}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('removeLines.options.caseSensitive')}
                  checked={options.caseSensitive}
                  onChange={(val) => setOptions((prev) => ({ ...prev, caseSensitive: val }))}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('removeLines.options.useRegex')}
                  checked={options.useRegex}
                  onChange={(val) => setOptions((prev) => ({ ...prev, useRegex: val }))}
                />
              </div>
            </div>

            <div className="row box-write-name">
              <div className="form-add-render">
                <InputText
                  value={options.pattern}
                  setValue={(val) => setOptions((prev) => ({ ...prev, pattern: val }))}
                  placeHolder={t('removeLines.patternPlaceholder')}
                  enableClearTextBtn={true}
                  enableLeftIcon={true}
                  leftIcon={<Trash2 size={20} />}
                  required
                />
              </div>
            </div>

            <div className="remove-actions">
              <button
                onClick={() => handleRemoveLines('duplicates')}
                className="remove-action-button duplicates"
              >
                {t('removeLines.modes.duplicates')}
              </button>
              <button
                onClick={() => handleRemoveLines('containing')}
                className="remove-action-button containing"
              >
                {t('removeLines.modes.containing')}
              </button>
              <button
                onClick={() => handleRemoveLines('notContaining')}
                className="remove-action-button not-containing"
              >
                {t('removeLines.modes.notContaining')}
              </button>
            </div>

            <div className="processing-status-container">
              <ProcessingStatus />
            </div>
          </div>
        </section>

        {showResult && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('removeLines.result')}</span>
              <span className="right">
                {removedLines > 0 && t('removeLines.processed', { removed: removedLines })}
              </span>
            </div>
            <div className="content flex-column">
              <div className="result-header">
                <CopyButton toCopy={resultText} />
              </div>
              <div className="scroll-box">
                <textarea
                  value={resultText}
                  readOnly
                  className="result"
                  placeholder={t('removeLines.resultPlaceholder')}
                />
              </div>
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}