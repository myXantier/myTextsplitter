import { useState, useCallback, useRef, useMemo, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp } from 'lucide-react';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import CustomSelect from '../components/CustomSelect';
import CopyButton from '../components/CopyButton';
import { OutdatedNotice, outdatedDescribedBy } from '../components/OutdatedNotice';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import { FileImport, importingTextareaProps } from '../hooks/useFileImport';
import { fileDragClassName, useDragAndDrop } from '../hooks/useDragAndDrop';
import { SORT_METHODS, type SortMethod } from '../utils/sortLines';
import { sameSortRequest, sortUsesCase, type SortRequest } from '../utils/resultRequests';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import { BaseService } from '../services/BaseService';
import { countLines } from '../services/SortService';
import { isSuperseded, processingErrorMessage, unwrapResult } from '../services/ProcessingError';
import useSnackbar from '../hooks/useSnackbar';
import './styles/SortPageStyle.css';

interface SortPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  sourceImport: FileImport;
  visible?: boolean;
}

export default function SortPage({ sourceText, setSourceText, sourceImport, visible }: SortPageProps) {
  const { t } = useTranslation();
  const [sortMethod, setSortMethod] = useState<SortMethod>('alphabetical');
  // Kept while a method without case option is selected, so it applies again after switching back
  const [caseSensitive, setCaseSensitive] = useState(true);
  /**
   * Shown result with the request it belongs to; a failed or superseded job never replaces it. `lines` is counted once
   * per result (counting 100 000 lines on every render would cost milliseconds per keystroke).
   */
  const [shown, setShown] = useState<{ text: string; lines: number; request: SortRequest } | null>(null);
  const [isSorting, setIsSorting] = useState(false);
  /** Page job number: only the latest job may change the result or show a message. */
  const jobCounter = useRef(0);
  const snackbar = useSnackbar();
  const { sortText } = useBackendProcessor();
  // A file dropped on the source text field is an import of the shared source text (same job as Open File)
  const sourceDrop = useDragAndDrop(sourceImport);

  const sortItems: Item<SortMethod>[] = useMemo(
    () => SORT_METHODS.map((method, index) => ({ label: t(`sortText.methods.${method}`), value: method, index })),
    [t]
  );

  const current: SortRequest = { sourceText, sortMethod, caseSensitive };
  // The shown result stays visible (it is the last valid one and can still be copied), but marked as outdated
  const outdated = shown !== null && !sameSortRequest(shown.request, current);
  const outdatedId = useId();

  /**
   * Text and options as currently entered, updated on every render. A job compares its request with it when its answer
   * arrives: a worker answer is a separate task, so the render of an input change made before it has already run.
   */
  const latestRequest = useRef(current);
  latestRequest.current = current;
  /** Request of the running page job (null when none runs). */
  const runningRequest = useRef<SortRequest | null>(null);

  // Text, method or a used case option changed while a job runs: that job sorts an input that is no longer entered.
  // It is stopped (worker terminated, BaseService ends it as `superseded`), shows nothing and ends the loading state;
  // the shown result stays (marked outdated). A case change that the running method ignores changes nothing.
  useEffect(() => {
    const running = runningRequest.current;
    if (running && !sameSortRequest(running, { sourceText, sortMethod, caseSensitive })) {
      jobCounter.current++;
      runningRequest.current = null;
      setIsSorting(false);
      BaseService.cancelPending('sort');
    }
  }, [sourceText, sortMethod, caseSensitive]);

  /**
   * Runs a sort (SortService: sort worker, latest job wins). A running older job is terminated (`superseded`). Only
   * the latest page job whose request is still the entered one may change the result or show a message; on failure
   * the previous result stays.
   */
  const handleSort = useCallback(async () => {
    // An empty text has nothing to sort; whitespace-only lines are data lines and are sorted
    if (sourceText === '') {
      jobCounter.current++;
      runningRequest.current = null;
      setIsSorting(false);
      BaseService.cancelPending('sort');
      snackbar.warning(t('errors.textRequired'));
      return;
    }

    const job = ++jobCounter.current;
    const request: SortRequest = { sourceText, sortMethod, caseSensitive };
    /** Still the latest page job and its input is still the entered one (also before the effect above has run). */
    const isCurrent = () => job === jobCounter.current && sameSortRequest(request, latestRequest.current);
    runningRequest.current = request;
    setIsSorting(true);
    try {
      const result = await sortText({ sourceText, mainParam: '', configParams: { sortMethod, caseSensitive } });
      if (!isCurrent()) return;
      // Validated in SortService (string, same line count as the input); an empty string is a valid result
      const text = unwrapResult(window.myResultConverter(result, 'Text'));
      const lines = countLines(text);
      setShown({ text, lines, request });
      snackbar.success(t('sortText.processed', { lines }));
    } catch (error) {
      // A superseded job was replaced by a newer click or an input change: nothing to report
      if (isCurrent() && !isSuperseded(error)) snackbar.error(processingErrorMessage(error, t));
    } finally {
      if (job === jobCounter.current) {
        runningRequest.current = null;
        setIsSorting(false);
      }
    }
  }, [sourceText, sortMethod, caseSensitive, sortText, snackbar, t]);

  const resultSummary = (request: SortRequest, lines: number) => {
    const values = { method: t(`sortText.methods.${request.sortMethod}`), lines };
    return sortUsesCase(request.sortMethod)
      ? t('sortText.resultForCase', { ...values, case: t(request.caseSensitive ? 'sortText.caseSensitive' : 'sortText.caseInsensitive') })
      : t('sortText.resultFor', values);
  };

  return (
    <div className={`sort-text app-container-column ${visible ? '' : 'hide-page'}`}>
      <ScrollableContainer>
        <section className="app-section flex-1">
          <div className="title">
            <span className="left">{t('sourceText.label')}</span>
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
              {...sourceDrop.dragHandlers}
              {...importingTextareaProps(sourceImport)}
              className={fileDragClassName(sourceDrop.isDragging)}
              placeholder={t('sourceText.placeholder')}
            />
          </div>
        </section>

        <section className="app-section">
          <div className="title">
            <span className="left">{t('sortText.options.title')}</span>
            <span className="right">{t('sortText.options.hint')}</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <CustomSelect
                  label={t('sortText.options.method')}
                  items={sortItems}
                  value={sortMethod}
                  onChange={(value) => setSortMethod(value)}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('sortText.options.caseSensitive')}
                  title={sortUsesCase(sortMethod) ? undefined : t('sortText.options.caseSensitiveHint')}
                  checked={caseSensitive}
                  disabled={!sortUsesCase(sortMethod)}
                  onChange={setCaseSensitive}
                />
              </div>
            </div>

            <div className="sort-actions">
              <button onClick={handleSort} className="sort-button" aria-busy={isSorting}>
                <ArrowDownUp size={20} />
                <span>{isSorting ? t('sortText.sorting') : t('sortText.process')}</span>
              </button>
            </div>
          </div>
        </section>

        {shown !== null && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('sortText.result')}</span>
              <span className="right sort-result-for">{resultSummary(shown.request, shown.lines)}</span>
            </div>
            <div className="content flex-column">
              <div className="result-header">
                <OutdatedNotice outdated={outdated} id={outdatedId} hint={t('sortText.outdated')} className="sort-result-outdated" />
                <CopyButton toCopy={shown.text} />
              </div>
              <div className={`scroll-box ${outdated ? 'result-outdated' : ''}`}>
                <textarea
                  value={shown.text}
                  readOnly
                  aria-describedby={outdatedDescribedBy(outdated, outdatedId)}
                  className="result"
                  placeholder={t('sortText.resultPlaceholder')}
                />
              </div>
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}
