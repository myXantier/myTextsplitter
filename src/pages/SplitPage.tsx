import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SplitSquareHorizontal, TextIcon } from 'lucide-react';
import InputText from '../components/InputText';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { ResultColumns } from './pageComponents/ResultColumns';
import { CombineColumns } from './pageComponents/CombineColumns';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import { useRuntimeSetting, usePermanentSetting, setRuntimeSetting, setPermanentSetting } from '../hooks/useSettings';
import { useCombineHistoryStore } from '../hooks/useCombineHistoryStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { patternProblem } from '../utils/regexPattern';
import { lineFormatOf } from '../utils/lines';
import { BaseService } from '../services/BaseService';
import { ERROR_KEYS, isSuperseded, processingErrorMessage, unwrapResult } from '../services/ProcessingError';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import { FileImport, importingTextareaProps } from '../hooks/useFileImport';
import useSnackbar from '../hooks/useSnackbar';
import './styles/SplitPageStyle.css';

interface SplitPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  sourceImport: FileImport;
  splitResults: string[][];
  setSplitResults: Dispatch<SetStateAction<string[][]>>;
  visible?: boolean;
}

const TEST_RUN = false;

export default function SplitPage({
  sourceText,
  setSourceText,
  sourceImport,
  splitResults,
  setSplitResults,
  visible,
}: SplitPageProps) {
  const { t } = useTranslation();
  const { splitText } = useBackendProcessor();
  const [isLoading, setIsLoading] = useState(false);
  const [currentWorkerAbort, setCurrentWorkerAbort] = useState<(() => void) | null>(null);
  const snackbar = useSnackbar();

  // const { runtime, setRuntime, permanent, setPermanent } = useSettings();
  const showLineNumbers = usePermanentSetting('showLineNumbers');
  const trimLine = usePermanentSetting('trimLine');
  const trimParts = usePermanentSetting('trimParts');
  // `showEmptyLines` controls the split: keep (true) or skip (false) empty input lines.
  // Desktop settings are not sanitized; a missing value (null) keeps the default behaviour.
  const keepEmptyLines = usePermanentSetting('showEmptyLines') !== false;
  const isDarkMode = usePermanentSetting('isDarkMode');
  const fontSize = usePermanentSetting('fontSize');

  const separator = useRuntimeSetting('separator');
  const useRegex = useRuntimeSetting('useRegex');

  // const { undoCombine, redoCombine, canUndo, canRedo } = useCombineHistoryStore();
  const canUndo = useCombineHistoryStore((state) => state.canUndo());
  const undoCombine = useCombineHistoryStore((state) => state.undoCombine);
  const canRedo = useCombineHistoryStore((state) => state.canRedo());
  const redoCombine = useCombineHistoryStore((state) => state.redoCombine);
  const setLineFormat = useCombineHistoryStore((state) => state.setLineFormat);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        if (!navigator.clipboard) {
          throw new Error('Clipboard API nicht verfügbar');
        }
        await navigator.clipboard.writeText(text);
        snackbar.success(t('notifications.copied'));
      } catch (error) {
        window.logger.error('Clipboard Fehler:', error);
        snackbar.error('Fehler beim Kopieren');
      }
    },
    [snackbar, t]
  );

  useKeyboardShortcuts({
    onSplit: () => {},
    onUndo: () => {
      if (canUndo) undoCombine();
    },
    onRedo: () => {
      if (canRedo) redoCombine();
    },
    onCopy: () => {
      const selection = window.getSelection()?.toString();
      if (selection) {
        copyToClipboard(selection);
      }
    },
  });

  const handleSplit = useCallback(async () => {
    if (TEST_RUN) {
      const testResult = [['test'], ['text']];
      setSplitResults(testResult);
      snackbar.info('Set test-result.');
      return;
    }

    if (!sourceText) return;

    if (currentWorkerAbort) {
      window.logger.warn('⏳ Abbruch des vorherigen Splitting-Prozesses...');
      currentWorkerAbort();
    }

    setIsLoading(true);
    // A superseded job leaves the loading state to the newer job (which may still be running)
    let superseded = false;

    try {
      const delimiter = separator;

      // Only the engine-neutral pattern rule here (Paket 10 E3, the engines check it too): the syntax is checked by the
      // engine that runs the split (Rust: fancy-regex, JS: RegExp in the worker), so Rust-only patterns like `(?i)` are
      // not rejected
      const problem = useRegex ? patternProblem(delimiter) : null;
      if (problem) {
        // The result of a still running older split would no longer match the input
        BaseService.cancelPending('split');
        snackbar.error(t(ERROR_KEYS[problem]));
        return;
      }
      // Paket 10 E4: an empty plain delimiter is invalid input (the engines refuse it too); spaces are allowed
      if (!useRegex && delimiter === '') {
        BaseService.cancelPending('split');
        snackbar.error(t(ERROR_KEYS.emptyDelimiter));
        return;
      }

      const result = await splitText({
        sourceText,
        mainParam: delimiter,
        configParams: {
          trimParts: trimParts,
          useRegex: useRegex,
          keepEmptyLines: keepEmptyLines,
        },
      });

      // Previous results stay visible if the processing or the result check fails
      setSplitResults(unwrapResult(window.myResultConverter(result, 'ColumnList')));
      // Combine and the column copy use the line ending and trailing newline of the text that was split
      setLineFormat(lineFormatOf(sourceText));
    } catch (error) {
      // A superseded job was replaced by a newer click: nothing to report
      superseded = isSuperseded(error);
      if (!superseded) snackbar.error(processingErrorMessage(error, t));
    } finally {
      if (!superseded) setIsLoading(false);
    }
  }, [sourceText, useRegex, trimParts, keepEmptyLines, separator, splitText, setSplitResults, setLineFormat, currentWorkerAbort, t]);

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      BaseService.cleanupWorkers();
    }, 60_000);
    return () => clearInterval(cleanupInterval);
  }, []);

  return (
    <div className={`split-text app-container-column ${visible ? '' : 'hide-page'}`}>
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
                title="Reset all fields to default"
                onClick={() => setSourceText('')}
              />
            </div>
            <OpenFileButton fileImport={sourceImport} />
          </div>
          <div className="content2 flex-column">
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              {...importingTextareaProps(sourceImport)}
              placeholder={t('sourceText.placeholder')}
            />
          </div>
        </section>
        <section className="app-section">
          <div className="title">
            <span className="left">SPLIT OPTIONS</span>
            <span className="right">Configure how the text should be split</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <Checkbox
                  label={t('options.trimLines')}
                  checked={trimLine}
                  onChange={(val) => setPermanentSetting('trimLine', val)}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('options.trimparts')}
                  checked={trimParts}
                  onChange={(val) => setPermanentSetting('trimParts', val)}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('regex.useRegex')}
                  checked={useRegex}
                  onChange={(val) => setRuntimeSetting('useRegex', val)}
                />
              </div>
            </div>

            <div className="row box-write-name">
              <div className="form-add-render">
                <InputText
                  value={separator}
                  setValue={(val) => setRuntimeSetting('separator', val)}
                  placeHolder="Enter split delim or pattern ..."
                  enableClearTextBtn={true}
                  enableLeftIcon={true}
                  leftIcon={<TextIcon size={20} />}
                  required
                />

                <IconRoundedButton
                  highlightIcon={true}
                  size="30px"
                  svgIcon={<SplitSquareHorizontal size={20} />}
                  title="Split text"
                  onClick={handleSplit}
                />
              </div>
            </div>

            <div className="processing-status-container">
              <ProcessingStatus />
            </div>
          </div>
        </section>
        {splitResults.length > 0 && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">SPLIT RESULT</span>
              <span className="right">Split text result</span>
            </div>
            <div className="content flex-column">
              <ResultColumns
                splitResults={splitResults}
                setSplitResults={setSplitResults}
                showLineNumbers={showLineNumbers}
                fontSize={fontSize}
                isDarkMode={isDarkMode}
              />
              <CombineColumns />
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}
