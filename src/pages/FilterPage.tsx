import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, SearchCode } from 'lucide-react';
import InputText from '../components/InputText';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { OutdatedNotice, outdatedDescribedBy } from '../components/OutdatedNotice';
import { MatchPreview } from '../components/MatchPreview';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import { useRuntimeSetting } from '../hooks/useSettings';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import { FileImport, importingTextareaProps } from '../hooks/useFileImport';
import { fileDragClassName, useDragAndDrop } from '../hooks/useDragAndDrop';
import useSnackbar from '../hooks/useSnackbar';
import { ERROR_KEYS, isSuperseded, processingErrorMessage, unwrapResult } from '../services/ProcessingError';
import { BaseService } from '../services/BaseService';
import { sameFilterRequest, type FilterAction, type FilterRequest } from '../utils/resultRequests';
import './styles/FilterPageStyle.css';

interface FilterPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  sourceImport: FileImport;
  visible: boolean;
}

/** Entered text and options of the Filter page (a request without its action). */
type FilterInputs = Omit<FilterRequest, 'action'>;

/** The action is a button, not an input: a request is compared with the inputs as if its own action was chosen. */
const matchesInputs = (request: FilterRequest, inputs: FilterInputs) => sameFilterRequest(request, { ...inputs, action: request.action });

export default function FilterPage({
  sourceText,
  setSourceText,
  sourceImport,
  visible,
}: FilterPageProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  /** Shown result with the request it belongs to; a failed, superseded or outdated job never replaces it. */
  const [shown, setShown] = useState<{ text: string; request: FilterRequest } | null>(null);
  const [options, setOptions] = useState({
    caseSensitive: true,
    pattern: '',
    splitMatches: false,
    showMatched: false,
  });

  const { filterText } = useBackendProcessor();
  // A file dropped on the source text field is an import of the shared source text (same job as Open File)
  const sourceDrop = useDragAndDrop(sourceImport);
  // Same rule as useBackendProcessor: 'backend' runs the Filter in Rust
  const processingMode = useRuntimeSetting('processingMode');

  /** Page job number: only the latest job may change the result or show a message (Paket 12, same as Sort). */
  const jobCounter = useRef(0);
  /** Request of the running page job (null when none runs). */
  const runningRequest = useRef<FilterRequest | null>(null);
  const { pattern, caseSensitive, splitMatches } = options;
  /**
   * Text and options as currently entered, updated on every render; a job compares its request with it when its answer
   * arrives (also before the effect below has run). `showMatched` only controls the preview and is no input.
   */
  const inputs: FilterInputs = { sourceText, pattern, caseSensitive, splitMatches, processingMode };
  const latestInputs = useRef(inputs);
  latestInputs.current = inputs;

  // The shown result stays visible (selectable), but marked as outdated when its inputs are no longer the entered ones
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
      BaseService.cancelPending('filter');
    }
  }, []);

  // An input the running job uses (for its own action) changed: that job filters an input that is no longer entered
  useEffect(() => {
    const running = runningRequest.current;
    if (running && !matchesInputs(running, { sourceText, pattern, caseSensitive, splitMatches, processingMode })) invalidate();
  }, [sourceText, pattern, caseSensitive, splitMatches, processingMode, invalidate]);

  // Leaving the page: a running job neither changes state nor shows a message on another page
  useEffect(() => invalidate, [invalidate]);

  /**
   * Runs a filter (FilterService: Rust or filter worker, latest job wins). Only the latest page job whose request is still
   * the entered one may change the result or show a message; on failure the previous result and its request stay.
   */
  const handleProcessText = useCallback(
    async (action: FilterAction) => {
      if (!sourceText || !pattern) {
        // A still running older job would no longer match the input (R1); the shown result stays
        invalidate();
        // Paket 10 E3: with a text, a missing pattern is the empty regex pattern (the engines refuse it too; a too long
        // pattern is reported by the engine)
        snackbar.error(t(sourceText ? ERROR_KEYS.patternEmpty : 'errors.textAndPatternRequired'));
        return;
      }

      const job = ++jobCounter.current;
      // `remove` never splits matches (the value sent to the engines)
      const request: FilterRequest = { action, sourceText, pattern, caseSensitive, splitMatches: action === 'keep' ? splitMatches : false, processingMode };
      const isCurrent = () => job === jobCounter.current && matchesInputs(request, latestInputs.current);
      runningRequest.current = request;
      try {
        const result = await filterText({
          sourceText: request.sourceText,
          mainParam: request.pattern,
          configParams: { caseSensitive: request.caseSensitive, filterMode: action, splitMatches: request.splitMatches },
        });
        if (!isCurrent()) return;
        // An empty text is a valid result (all lines filtered out)
        setShown({ text: unwrapResult(window.myResultConverter(result, 'Text')), request });
        snackbar.success(t('textFilter.processed'));
      } catch (error) {
        // A superseded or outdated job was replaced by a newer click or an input change: nothing to report
        if (isCurrent() && !isSuperseded(error)) snackbar.error(processingErrorMessage(error, t));
      } finally {
        if (job === jobCounter.current) runningRequest.current = null;
      }
    },
    [sourceText, pattern, caseSensitive, splitMatches, processingMode, filterText, invalidate, snackbar, t]
  );

  return (
    <div className={`filter-text app-container-column ${visible ? '' : 'hide-page'}`}>
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
              placeholder={t('textFilter.sourcePlaceholder')}
            />
          </div>
        </section>

        <section className="app-section">
          <div className="title">
            <span className="left">FILTER OPTIONS</span>
            <span className="right">Configure how the text should be filtered</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <Checkbox
                  label={t('textFilter.options.caseSensitive')}
                  checked={options.caseSensitive}
                  onChange={(val) => setOptions((prev) => ({ ...prev, caseSensitive: val }))}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('textFilter.options.splitMatches')}
                  checked={options.splitMatches}
                  onChange={(val) => setOptions((prev) => ({ ...prev, splitMatches: val }))}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label="Show pattern matches"
                  checked={options.showMatched}
                  onChange={(val) => setOptions((prev) => ({ ...prev, showMatched: val }))}
                />
              </div>
            </div>

            <div className="row box-write-name">
              <div className="form-add-render">
                <InputText
                  value={options.pattern}
                  setValue={(val) => setOptions((prev) => ({ ...prev, pattern: val }))}
                  placeHolder={t('textFilter.patternPlaceholder')}
                  enableClearTextBtn={true}
                  enableLeftIcon={true}
                  leftIcon={<SearchCode size={20} />}
                  required
                />

                <div className="filter-actions">
                  <IconRoundedButton
                    onClick={() => handleProcessText('remove')}
                    title={t('textFilter.modes.remove')}
                    size="30px"
                    svgIcon={<Filter size={20} />}
                    colorDefault="var(--app-color-red)"
                  />
                  <IconRoundedButton
                    onClick={() => handleProcessText('keep')}
                    title={t('textFilter.modes.keep')}
                    size="30px"
                    svgIcon={<Filter size={20} />}
                    colorDefault="var(--app-color-green)"
                  />
                </div>
              </div>
            </div>

            {options.showMatched && options.pattern && sourceText && (
              <MatchPreview
                sourceText={sourceText}
                pattern={options.pattern}
                caseSensitive={options.caseSensitive}
                splitMatches={options.splitMatches}
                engine={processingMode === 'backend' ? 'rust' : 'js'}
              />
            )}

            <div className="processing-status-container">
              <ProcessingStatus />
            </div>
          </div>
        </section>

        {shown !== null && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">FILTER RESULT</span>
              {/* Action of the shown result (also while another action runs or after it failed) */}
              <span className="right filter-result-for">{t(`textFilter.modes.${shown.request.action}`)}</span>
            </div>
            <div className="content flex-column">
              <div className="result-header">
                <OutdatedNotice outdated={outdated} id={outdatedId} />
              </div>
              <div className={`scroll-box ${outdated ? 'result-outdated' : ''}`}>
                <textarea
                  value={shown.text}
                  readOnly
                  aria-describedby={outdatedDescribedBy(outdated, outdatedId)}
                  className="result"
                  placeholder={t('textFilter.resultPlaceholder')}
                />
              </div>
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}