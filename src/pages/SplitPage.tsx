import { Dispatch, SetStateAction, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SplitSquareHorizontal, TextIcon } from 'lucide-react';
import InputText from '../components/InputText';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { OutdatedNotice, outdatedDescribedBy } from '../components/OutdatedNotice';
import { ResultColumns } from './pageComponents/ResultColumns';
import { CombineColumns } from './pageComponents/CombineColumns';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import { useRuntimeSetting, usePermanentSetting, setRuntimeSetting, setPermanentSetting } from '../hooks/useSettings';
import { useCombineHistoryStore } from '../hooks/useCombineHistoryStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { patternProblem } from '../utils/regexPattern';
import { lineFormatOf } from '../utils/lines';
import { sameSplitRequest, type SplitRequest } from '../utils/resultRequests';
import { BaseService } from '../services/BaseService';
import { ERROR_KEYS, isSuperseded, processingErrorMessage, unwrapResult } from '../services/ProcessingError';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import { FileImport, importingTextareaProps } from '../hooks/useFileImport';
import { fileDragClassName, useDragAndDrop } from '../hooks/useDragAndDrop';
import useSnackbar from '../hooks/useSnackbar';
import './styles/SplitPageStyle.css';

interface SplitPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  sourceImport: FileImport;
  splitResults: string[][];
  setSplitResults: Dispatch<SetStateAction<string[][]>>;
  /** Request of the shown columns (kept with them in LeftMenuBar across page changes) */
  splitRequest: SplitRequest | null;
  setSplitRequest: Dispatch<SetStateAction<SplitRequest | null>>;
  visible?: boolean;
}

const TEST_RUN = false;

export default function SplitPage({
  sourceText,
  setSourceText,
  sourceImport,
  splitResults,
  setSplitResults,
  splitRequest,
  setSplitRequest,
  visible,
}: SplitPageProps) {
  const { t } = useTranslation();
  const { splitText } = useBackendProcessor();
  // A file dropped on the source text field is an import of the shared source text (same job as Open File)
  const sourceDrop = useDragAndDrop(sourceImport);
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
  // Same rule as useBackendProcessor: 'backend' runs the split in Rust
  const processingMode = useRuntimeSetting('processingMode');

  // const { undoCombine, redoCombine, canUndo, canRedo } = useCombineHistoryStore();
  const canUndo = useCombineHistoryStore((state) => state.canUndo());
  const undoCombine = useCombineHistoryStore((state) => state.undoCombine);
  const canRedo = useCombineHistoryStore((state) => state.canRedo());
  const redoCombine = useCombineHistoryStore((state) => state.redoCombine);
  const setLineFormat = useCombineHistoryStore((state) => state.setLineFormat);

  /** Page job number: only the latest job may change the result or show a message (Paket 12, same as Sort). */
  const jobCounter = useRef(0);
  /** Request of the running page job (null when none runs). */
  const runningRequest = useRef<SplitRequest | null>(null);
  /**
   * Text and split options as currently entered (page and settings modal), updated on every render; a job compares its
   * request with it when its answer arrives (also before the effect below has run). `trimLine` has no effect on the
   * split and is no input; neither are the display options and the combine separator.
   */
  const inputs: SplitRequest = { sourceText, delimiter: separator, useRegex, trimParts, keepEmptyLines, processingMode };
  const latestInputs = useRef(inputs);
  latestInputs.current = inputs;

  // The shown columns stay visible and usable (also after a page change), but marked as outdated when their request is
  // no longer the entered one
  const outdated = splitResults.length > 0 && splitRequest !== null && !sameSplitRequest(splitRequest, inputs);
  const outdatedId = useId();

  /**
   * Makes the running page job outdated: it changes neither the columns nor their request or line format and shows no
   * message, and it is stopped (worker terminated, BaseService ends it as `superseded`; a Rust job has its late answer
   * discarded). A job, once outdated, stays outdated.
   */
  const invalidate = useCallback(() => {
    jobCounter.current++;
    if (runningRequest.current) {
      runningRequest.current = null;
      setIsLoading(false);
      BaseService.cancelPending('split');
    }
  }, []);

  // A text or split option the running job uses changed (also in the settings modal): it splits an input that is no
  // longer entered
  useEffect(() => {
    const running = runningRequest.current;
    if (running && !sameSplitRequest(running, { sourceText, delimiter: separator, useRegex, trimParts, keepEmptyLines, processingMode })) invalidate();
  }, [sourceText, separator, useRegex, trimParts, keepEmptyLines, processingMode, invalidate]);

  // Leaving the page: a running split neither changes the kept columns nor shows a message on another page
  useEffect(() => invalidate, [invalidate]);

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

    // An empty text is still refused silently; a still running older split would no longer match the input (R1)
    if (!sourceText) {
      invalidate();
      return;
    }

    if (currentWorkerAbort) {
      window.logger.warn('⏳ Abbruch des vorherigen Splitting-Prozesses...');
      currentWorkerAbort();
    }

    const delimiter = separator;

    // Only the engine-neutral pattern rule here (Paket 10 E3, the engines check it too): the syntax is checked by the
    // engine that runs the split (Rust: fancy-regex, JS: RegExp in the worker), so Rust-only patterns like `(?i)` are
    // not rejected
    const problem = useRegex ? patternProblem(delimiter) : null;
    if (problem) {
      // The result of a still running older split would no longer match the input; the shown columns stay
      invalidate();
      snackbar.error(t(ERROR_KEYS[problem]));
      return;
    }
    // Paket 10 E4: an empty plain delimiter is invalid input (the engines refuse it too); spaces are allowed
    if (!useRegex && delimiter === '') {
      invalidate();
      snackbar.error(t(ERROR_KEYS.emptyDelimiter));
      return;
    }

    const job = ++jobCounter.current;
    const request: SplitRequest = { sourceText, delimiter, useRegex, trimParts, keepEmptyLines, processingMode };
    /** Still the latest page job and its request is still the entered one (also before the invalidating effect ran). */
    const isCurrent = () => job === jobCounter.current && sameSplitRequest(request, latestInputs.current);
    runningRequest.current = request;
    setIsLoading(true);

    try {
      const result = await splitText({
        sourceText: request.sourceText,
        mainParam: request.delimiter,
        configParams: {
          trimParts: request.trimParts,
          useRegex: request.useRegex,
          keepEmptyLines: request.keepEmptyLines,
        },
      });
      if (!isCurrent()) return;

      // Previous results (and their request) stay if the processing or the result check fails
      setSplitResults(unwrapResult(window.myResultConverter(result, 'ColumnList')));
      setSplitRequest(request);
      // Combine and the column copy use the line ending and trailing newline of the text that was split
      setLineFormat(lineFormatOf(request.sourceText));
    } catch (error) {
      // A superseded or outdated job was replaced by a newer click or an input change: nothing to report
      if (isCurrent() && !isSuperseded(error)) snackbar.error(processingErrorMessage(error, t));
    } finally {
      // A superseded job leaves the loading state to the newer job (which may still be running)
      if (job === jobCounter.current) {
        runningRequest.current = null;
        setIsLoading(false);
      }
    }
  }, [sourceText, useRegex, trimParts, keepEmptyLines, separator, processingMode, splitText, setSplitResults, setSplitRequest, setLineFormat, currentWorkerAbort, invalidate, snackbar, t]);

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
              {...sourceDrop.dragHandlers}
              {...importingTextareaProps(sourceImport)}
              className={fileDragClassName(sourceDrop.isDragging)}
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
          // The outdated mark covers the columns and the combine area
          <section className={`app-section flex-1 ${outdated ? 'result-outdated' : ''}`}>
            <div className="title">
              <span className="left">SPLIT RESULT</span>
              <span className="right">Split text result</span>
            </div>
            <div className="content flex-column">
              <div className="split-result-status">
                <OutdatedNotice outdated={outdated} id={outdatedId} />
              </div>
              <ResultColumns
                splitResults={splitResults}
                setSplitResults={setSplitResults}
                showLineNumbers={showLineNumbers}
                fontSize={fontSize}
                isDarkMode={isDarkMode}
                describedBy={outdatedDescribedBy(outdated, outdatedId)}
              />
              <CombineColumns />
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}
