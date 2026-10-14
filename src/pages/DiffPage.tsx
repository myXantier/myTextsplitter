import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import CopyButton from '../components/CopyButton';
import { fontSizeToIconSize } from '../utils/helper';
import useSnackbar from '../hooks/useSnackbar';
import { isSuperseded, processingErrorMessage, unwrapResult } from '../services/ProcessingError';
import { usePermanentSetting } from '../hooks/useSettings';
import { BaseService } from '../services/BaseService';
import { buildDiffView, formatDiffText, type DiffViewCell } from '../utils/diff/viewModel';
import type { DiffData } from '../utils/diff/result';
import type { IntralineSkipReason } from '../utils/diff/types';
import './styles/DiffPageStyle.css';

interface DiffPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  visible: boolean;
}

type DiffViewType = 'unified' | 'split';

/** The compared texts of a request (kept to recompute the same comparison with word diff). */
interface DiffRequest {
  sourceText: string;
  newText: string;
  ignoreWhitespace: boolean;
}

/** Rows rendered at once; more on request (large diffs would otherwise create tens of thousands of DOM rows). */
const ROW_PAGE = 2_000;

const SKIP_REASONS: IntralineSkipReason[] = ['lineTooLong', 'hunkTooLarge', 'budgetExceeded', 'tooComplex'];

export default function DiffPage({
  sourceText,
  setSourceText,
  visible,
}: DiffPageProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const [newText, setNewText] = useState('');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [diffViewType, setDiffViewType] = useState<DiffViewType>('unified');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  // Optional word diff, off by default (page state only, it was never persisted)
  const [wordDiff, setWordDiff] = useState(false);
  const [rowLimit, setRowLimit] = useState(ROW_PAGE);

  /** Latest requested comparison, and whether its running job computes the word diff (`null`: no job running). */
  const lastRequest = useRef<DiffRequest | null>(null);
  const runningWordDiff = useRef<boolean | null>(null);
  /** Comparison of the shown result (`lastRequest` falls back to it when a running comparison is cancelled). */
  const shownRequest = useRef<DiffRequest | null>(null);
  /** Page job number: only the latest job may change the result or show a message. */
  const jobCounter = useRef(0);

  const { diffText } = useBackendProcessor();
  const fontSize = usePermanentSetting('fontSize');

  /**
   * Runs a comparison. Only the latest job is delivered (BaseService: an older one ends as `superseded`), so a late
   * result never replaces a newer one; in addition an outdated page job changes no state and shows no message. The word
   * diff is shown only while the switch is on (`view` below), so a result with word diff that arrives after the switch
   * was turned off is displayed without it.
   */
  const runDiff = useCallback(
    async (request: DiffRequest, withWordDiff: boolean, announce: boolean) => {
      const job = ++jobCounter.current;
      lastRequest.current = request;
      runningWordDiff.current = withWordDiff;
      try {
        const result = await diffText({
          sourceText: request.sourceText,
          mainParam: request.newText,
          configParams: { caseSensitive: true, ignoreWhitespace: request.ignoreWhitespace, wordDiff: withWordDiff },
        });
        if (job !== jobCounter.current) return;
        // Validated in DiffService (line diff, word diff of it, present exactly when requested); on failure the previous diff stays
        setDiffData(unwrapResult(window.myResultConverter(result, 'Diff')));
        shownRequest.current = request;
        if (announce) snackbar.success(t('textDiff.processed'));
      } catch (error) {
        // A superseded or cancelled job was replaced by a newer action: nothing to report
        if (job === jobCounter.current && !isSuperseded(error)) snackbar.error(processingErrorMessage(error, t));
      } finally {
        if (job === jobCounter.current) runningWordDiff.current = null;
      }
    },
    [diffText, snackbar, t],
  );

  /**
   * Makes a running comparison outdated (a newer action replaced it): the worker job is terminated, a Rust job (cannot
   * be stopped) has its late result discarded (`BaseService.cancelPending`, its promise ends as `superseded`), and the
   * page ignores it. The shown result stays; switching the word diff on afterwards uses the shown comparison.
   */
  const cancelRunningDiff = useCallback(() => {
    jobCounter.current++;
    runningWordDiff.current = null;
    lastRequest.current = shownRequest.current;
    BaseService.cancelPending('diff');
  }, []);

  const handleDiffText = useCallback(() => {
    // One side may be empty (everything added or removed); comparing two empty texts shows nothing
    if (!sourceText && !newText) {
      // The result of a still running older comparison would no longer match the input
      cancelRunningDiff();
      snackbar.error(t('errors.textRequired'));
      return;
    }
    void runDiff({ sourceText, newText, ignoreWhitespace }, wordDiff, true);
  }, [sourceText, newText, ignoreWhitespace, wordDiff, runDiff, cancelRunningDiff, snackbar, t]);

  /**
   * Switching the word diff on computes it if it is missing (same texts as the comparison, not the edited textareas):
   * while a comparison without word diff runs, for that running comparison (it is replaced); otherwise for the shown
   * result, never for a comparison that failed. Switching it off only hides it.
   */
  const handleWordDiffChange = (checked: boolean) => {
    setWordDiff(checked);
    if (!checked) return;
    const running = runningWordDiff.current;
    if (running === true) return;
    if (running === false) {
      if (lastRequest.current) void runDiff(lastRequest.current, true, false);
      return;
    }
    if (!diffData?.intraline && shownRequest.current) void runDiff(shownRequest.current, true, false);
  };

  // Only rebuilt when the result or the word diff switch changes (not on every keystroke in the textareas)
  const view = useMemo(() => (diffData ? buildDiffView(diffData.document, wordDiff ? diffData.intraline : null) : null), [diffData, wordDiff]);
  const copyText = useMemo(() => (view ? formatDiffText(view) : ''), [view]);
  useEffect(() => setRowLimit(ROW_PAGE), [view]);

  const kindClass = (cell: DiffViewCell) =>
    [cell.kind === 'removed' ? 'diff-removed' : cell.kind === 'added' ? 'diff-added' : '', cell.move ? 'diff-moved' : '', cell.segments ? 'diff-paired' : '']
      .filter(Boolean)
      .join(' ');
  const marker = (cell: DiffViewCell) => (cell.move ? '↷' : cell.kind === 'removed' ? '-' : cell.kind === 'added' ? '+' : ' ');

  const renderContent = (cell: DiffViewCell) => {
    if (cell.segments) {
      return (
        <span className="diff-line-content">
          {cell.segments.map((segment, i) =>
            segment.op === 'equal' ? (
              <span key={i}>{segment.text}</span>
            ) : (
              <span key={i} className={`word-diff ${segment.op === 'delete' ? 'diff-removed' : 'diff-added'}`}>
                {segment.text}
              </span>
            ),
          )}
        </span>
      );
    }
    if (cell.text === '') return <em className="diff-line-content empty-line">{t('textDiff.emptyLine')}</em>;
    return <span className="diff-line-content">{cell.text}</span>;
  };

  const renderHints = (cell: DiffViewCell) => (
    <>
      {cell.move && (
        <span className="diff-move-hint">
          {t(cell.kind === 'removed' ? 'textDiff.movedTo' : 'textDiff.movedFrom', { line: cell.move.otherLine })}
        </span>
      )}
      {cell.wordDiffSkipped && (
        <span className="diff-skip-hint" data-reason={cell.wordDiffSkipped}>
          {t(`textDiff.skipReasons.${cell.wordDiffSkipped}`)}
        </span>
      )}
    </>
  );

  const renderUnifiedDiffView = () => (
    <div className="unified-diff-view">
      {view!.unified.slice(0, rowLimit).map((row, index) => (
        <div key={index} className={`diff-line ${kindClass(row)}`} data-old-line={row.oldLine ?? ''} data-new-line={row.newLine ?? ''}>
          {showLineNumbers && (
            <>
              <span className="diff-line-number old">{row.oldLine ?? ''}</span>
              <span className="diff-line-number new">{row.newLine ?? ''}</span>
            </>
          )}
          <span className="diff-line-marker">{marker(row)}</span>
          {renderContent(row)}
          {renderHints(row)}
        </div>
      ))}
    </div>
  );

  const renderSplitCell = (cell: DiffViewCell | null, side: 'old' | 'new', index: number) =>
    cell ? (
      <div key={`${side}-${index}`} className={`diff-line ${kindClass(cell)}`} data-line={cell.line}>
        {showLineNumbers && <span className="diff-line-number">{cell.line}</span>}
        <span className="diff-line-marker">{marker(cell)}</span>
        {renderContent(cell)}
        {renderHints(cell)}
      </div>
    ) : (
      <div key={`${side}-${index}`} className="diff-line empty-slot">
        <span className="diff-line-placeholder"></span>
      </div>
    );

  const renderSplitDiffView = () => {
    const rows = view!.split.slice(0, rowLimit);
    return (
      <div className="split-diff-view">
        <div className="split-diff-original">
          <div className="split-diff-header">
            <h3>{t('textDiff.oldText')}</h3>
          </div>
          <div className="split-diff-content">{rows.map((row, index) => renderSplitCell(row.old, 'old', index))}</div>
        </div>
        <div className="split-diff-new">
          <div className="split-diff-header">
            <h3>{t('textDiff.newText')}</h3>
          </div>
          <div className="split-diff-content">{rows.map((row, index) => renderSplitCell(row.new, 'new', index))}</div>
        </div>
      </div>
    );
  };

  const totalRows = view ? (diffViewType === 'unified' ? view.unified.length : view.split.length) : 0;
  const stats = view?.stats;

  return (
    <div className={`diff-text app-container-column ${visible ? '' : 'hide-page'}`}>
      <ScrollableContainer>
        <div className="diff-columns">
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('textDiff.oldText')}</span>
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
                placeholder={t('textDiff.oldTextPlaceholder')}
              />
            </div>
          </section>

          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('textDiff.newText')}</span>
              <div className="reset-button">
                <IconRoundedButton
                  highlightIcon={true}
                  size="18px"
                  radius="6px"
                  svgIcon={<SvgIconReload size="16" />}
                  colorDefault="transparent"
                  title="Reset text"
                  onClick={() => setNewText('')}
                />
              </div>
              <OpenFileButton setFileText={setNewText} />
            </div>
            <div className="content2 flex-column">
              <textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder={t('textDiff.newTextPlaceholder')}
              />
            </div>
          </section>
        </div>

        <section className="app-section">
          <div className="title">
            <span className="left">{t('textDiff.options.title')}</span>
            <span className="right">{t('textDiff.options.hint')}</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <Checkbox
                  label={t('textDiff.options.trimWhitespace')}
                  checked={ignoreWhitespace}
                  onChange={setIgnoreWhitespace}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('textDiff.options.lineNumbers')}
                  checked={showLineNumbers}
                  onChange={setShowLineNumbers}
                />
              </div>

              <div className="input-box word-diff-option">
                <Checkbox
                  label={t('textDiff.options.wordDiff')}
                  checked={wordDiff}
                  onChange={handleWordDiffChange}
                />
              </div>

              <div className="input-box view-type-selector">
                <span className="view-type-label">{t('textDiff.view.label')}</span>
                <div className="view-type-options">
                  <button
                    className={`view-option ${diffViewType === 'unified' ? 'active' : ''}`}
                    onClick={() => setDiffViewType('unified')}
                  >
                    {t('textDiff.view.unified')}
                  </button>
                  <button
                    className={`view-option ${diffViewType === 'split' ? 'active' : ''}`}
                    onClick={() => setDiffViewType('split')}
                  >
                    {t('textDiff.view.split')}
                  </button>
                </div>
              </div>

              <div className="input-box">
                <button onClick={handleDiffText} className="diff-button">
                  <ArrowRight size={fontSizeToIconSize[fontSize]} />
                  <span>{t('textDiff.process')}</span>
                </button>
              </div>
            </div>

            <div className="processing-status-container">
              <ProcessingStatus />
            </div>
          </div>
        </section>

        {view && stats && view.unified.length > 0 && (
          <section className="app-section flex-1">
            <div className="title diff-result-title">
              <span className="left">{t('textDiff.result')}</span>
              <div className="title-actions">
                <CopyButton toCopy={copyText} />
                <span
                  className="diff-stats"
                  data-unchanged={stats.unchanged}
                  data-added={stats.added}
                  data-removed={stats.removed}
                  data-moved={stats.moved}
                  data-changed={stats.changed}
                  data-word-diff={view.wordDiff}
                >
                  {[
                    t('textDiff.stats.unchanged', { count: stats.unchanged }),
                    t('textDiff.stats.added', { count: stats.added }),
                    t('textDiff.stats.removed', { count: stats.removed }),
                    t('textDiff.stats.moved', { count: stats.moved }),
                  ].join(' · ')}
                  {/* The changed line pairs are part of added/removed, not a category of their own */}
                  {view.wordDiff && stats.changed > 0 && (
                    <span className="diff-stats-pairs"> — {t('textDiff.stats.changedPairs', { count: stats.changed })}</span>
                  )}
                </span>
              </div>
            </div>
            <div className="content flex-column">
              {view.wordDiff && stats.wordDiffSkippedLines > 0 && (
                <div className="diff-word-skips" data-lines={stats.wordDiffSkippedLines}>
                  {t('textDiff.wordDiffSkipped', { count: stats.wordDiffSkippedLines })}{' '}
                  ({SKIP_REASONS.filter((reason) => view.wordDiffSkips[reason])
                    .map((reason) => `${t(`textDiff.skipReasons.${reason}`)}: ${view.wordDiffSkips[reason]}`)
                    .join(', ')})
                </div>
              )}

              <div className="diff-result-container">
                {diffViewType === 'unified' ? renderUnifiedDiffView() : renderSplitDiffView()}
              </div>

              {totalRows > rowLimit && (
                <div className="diff-more-rows">
                  <span>{t('textDiff.rowsShown', { shown: rowLimit, total: totalRows })}</span>
                  <button className="view-option" onClick={() => setRowLimit((limit) => limit + ROW_PAGE)}>
                    {t('textDiff.showMore', { count: Math.min(ROW_PAGE, totalRows - rowLimit) })}
                  </button>
                </div>
              )}

              <div className="diff-legend">
                <div className="legend-item">
                  <span className="legend-marker added">+</span>
                  <span>{t('textDiff.legend.added')}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker removed">-</span>
                  <span>{t('textDiff.legend.removed')}</span>
                </div>
                {view.wordDiff && (
                  <div className="legend-item">
                    <span className="legend-marker changed">~</span>
                    <span>{t('textDiff.legend.changed')}</span>
                  </div>
                )}
                <div className="legend-item">
                  <span className="legend-marker moved">↷</span>
                  <span>{t('textDiff.legend.moved')}</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}
