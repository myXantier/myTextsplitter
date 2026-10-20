import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Trash2 } from 'lucide-react';
import InputText from '../components/InputText';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import CopyButton from '../components/CopyButton';
import { OutdatedNotice, outdatedDescribedBy } from '../components/OutdatedNotice';
import { fileDragClassName, useDragAndDrop } from '../hooks/useDragAndDrop';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import { FileImport, importingTextareaProps } from '../hooks/useFileImport';
import useSnackbar from '../hooks/useSnackbar';
import { ERROR_KEYS, isSuperseded, processingErrorMessage, unwrapResult } from '../services/ProcessingError';
import { BaseService } from '../services/BaseService';
import { useRuntimeSetting } from '../hooks/useSettings';
import { sameRemoveRequest, type RemoveAction, type RemoveRequest } from '../utils/resultRequests';
import './styles/RemovePageStyle.css';

interface RemovePageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  sourceImport: FileImport;
  visible: boolean;
}

/** Entered text and options of the Remove page (a request without its action). */
type RemoveInputs = Omit<RemoveRequest, 'action'>;

/** The action is a button, not an input: a request is compared with the inputs as if its own action was chosen. */
const matchesInputs = (request: RemoveRequest, inputs: RemoveInputs) => sameRemoveRequest(request, { ...inputs, action: request.action });

export default function RemovePage({ sourceText, setSourceText, sourceImport, visible }: RemovePageProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  /** Shown result with the request it belongs to; a failed, superseded or outdated job never replaces it. */
  const [shown, setShown] = useState<{ text: string; removed: number; request: RemoveRequest } | null>(null);
  const [options, setOptions] = useState({
    trim: true,
    caseSensitive: true,
    useRegex: false,
    pattern: '',
  });
  const { removeLines } = useBackendProcessor();
  // Same rule as useBackendProcessor: 'backend' runs Remove in Rust
  const processingMode = useRuntimeSetting('processingMode');

  // A dropped file is one more import of the shared source text: same job as the Open File button (latest wins)
  const { isDragging, dragHandlers } = useDragAndDrop(sourceImport);

  /** Page job number: only the latest job may change the result or show a message (Paket 12, same as Sort). */
  const jobCounter = useRef(0);
  /** Request of the running page job (null when none runs). */
  const runningRequest = useRef<RemoveRequest | null>(null);
  const { pattern, useRegex, caseSensitive, trim } = options;
  /**
   * Text and options as currently entered, updated on every render; a job compares its request with it when its answer
   * arrives (also before the effect below has run). Which of them count depends on the action (`sameRemoveRequest`).
   */
  const inputs: RemoveInputs = { sourceText, pattern, useRegex, caseSensitive, trim, processingMode };
  const latestInputs = useRef(inputs);
  latestInputs.current = inputs;

  // The shown result stays visible (it can still be copied), but marked as outdated when its inputs are no longer entered
  const outdated = shown !== null && !matchesInputs(shown.request, inputs);
  const outdatedId = useId();

  /**
   * Makes the running page job outdated: it shows nothing (no result, no message) and is stopped (worker terminated,
   * BaseService ends it as `superseded`; a Rust job has its late answer discarded). A job, once outdated, stays outdated.
   */
  const invalidate = useCallback(() => {
    jobCounter.current++;
    if (runningRequest.current) {
      runningRequest.current = null;
      BaseService.cancelPending('remove');
    }
  }, []);

  // An input the running job uses (for its own action) changed: that job processes an input that is no longer entered
  useEffect(() => {
    const running = runningRequest.current;
    if (running && !matchesInputs(running, { sourceText, pattern, useRegex, caseSensitive, trim, processingMode })) invalidate();
  }, [sourceText, pattern, useRegex, caseSensitive, trim, processingMode, invalidate]);

  // Leaving the page: a running job neither changes state nor shows a message on another page
  useEffect(() => invalidate, [invalidate]);

  /**
   * Removes lines (RemoveService: Rust, remove worker or main thread; latest job wins). Only the latest page job whose
   * request is still the entered one may change the result or show a message; on failure the previous result stays.
   */
  const handleRemoveLines = useCallback(
    async (action: RemoveAction) => {
      if (!sourceText) {
        // A still running older job would no longer match the input (R1); the shown result stays
        invalidate();
        snackbar.error(t('errors.textRequired'));
        return;
      }

      // Duplicates ignore the pattern. Paket 10 E3: an empty regex pattern has its own message (the engines refuse it
      // too; a too long one is reported by the engine, a plain search term is not limited)
      if (action !== 'duplicates' && !pattern) {
        invalidate();
        snackbar.error(t(useRegex ? ERROR_KEYS.patternEmpty : 'removeLines.enterPattern'));
        return;
      }

      const job = ++jobCounter.current;
      const request: RemoveRequest = { action, sourceText, pattern, useRegex, caseSensitive, trim, processingMode };
      const isCurrent = () => job === jobCounter.current && matchesInputs(request, latestInputs.current);
      runningRequest.current = request;
      try {
        const result = await removeLines({
          sourceText: request.sourceText,
          mainParam: request.pattern,
          configParams: { caseSensitive: request.caseSensitive, useRegex: request.useRegex, trimParts: request.trim, removeMode: action },
        });
        if (!isCurrent()) return;
        // An empty `result_text` is a valid result (all lines removed); on failure the previous result stays
        const { result_text, removed_lines } = unwrapResult(window.myResultConverter(result, 'TextV2'));
        setShown({ text: result_text, removed: removed_lines, request });
        snackbar.success(t('removeLines.processed', { removed: removed_lines }));
      } catch (error) {
        // A superseded or outdated job was replaced by a newer click or an input change: nothing to report
        if (isCurrent() && !isSuperseded(error)) snackbar.error(processingErrorMessage(error, t));
      } finally {
        if (job === jobCounter.current) runningRequest.current = null;
      }
    },
    [sourceText, pattern, useRegex, caseSensitive, trim, processingMode, removeLines, invalidate, snackbar, t]
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
            <OpenFileButton fileImport={sourceImport} />
          </div>
          <div className="content2 flex-column">
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              {...dragHandlers}
              {...importingTextareaProps(sourceImport)}
              className={fileDragClassName(isDragging)}
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
                {/* Only the duplicates action uses it (comparison key); the state is kept for every action */}
                <Checkbox
                  label={t('removeLines.options.trim')}
                  title={t('removeLines.options.trimHint')}
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

        {shown !== null && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('removeLines.result')}</span>
              {/* Action and removed lines of the shown result (also while another action runs or after it failed) */}
              <span className="right remove-result-for">
                {t(`removeLines.modes.${shown.request.action}`)} · {t('removeLines.processed', { removed: shown.removed })}
              </span>
            </div>
            <div className="content flex-column">
              <div className="result-header">
                <OutdatedNotice outdated={outdated} id={outdatedId} />
                <CopyButton toCopy={shown.text} />
              </div>
              <div className={`scroll-box ${outdated ? 'result-outdated' : ''}`}>
                <textarea
                  value={shown.text}
                  readOnly
                  aria-describedby={outdatedDescribedBy(outdated, outdatedId)}
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