import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchPreviewService } from '../services/Services';
import { BaseService } from '../services/BaseService';
import { ERROR_KEYS, ProcessingError, isSuperseded, processingErrorMessage } from '../services/ProcessingError';
import { PREVIEW_LIMITS, type MatchPreviewData, type PreviewRow } from '../utils/matchPreview';
import './styles/MatchPreviewStyle.css';

interface MatchPreviewProps {
  sourceText: string;
  pattern: string;
  caseSensitive: boolean;
  /** Filter option: with it, joined halves of a character are reported (the JS Filter would refuse them for keep) */
  splitMatches: boolean;
  /** Engine of the actual Filter processing. The preview itself always uses the JS RegExp (MatchPreviewService). */
  engine: 'js' | 'rust';
}

/** The preview job starts when typing pauses */
const PREVIEW_DELAY_MS = 250;

/**
 * Highlights the matches of the Filter pattern line by line. The regex runs in the preview worker (never in the
 * UI thread); a running preview is stopped when the pattern/text/options change or the preview is closed.
 * It shows regex matches, not the Filter result (Paket 10 E2). The answer is limited (`PREVIEW_LIMITS`): a limited
 * preview and shortened text are always marked.
 */
export function MatchPreview({ sourceText, pattern, caseSensitive, splitMatches, engine }: MatchPreviewProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<MatchPreviewData | null>(null);
  // The error, not its note: the note depends on the engine, which can change without a new preview run
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!pattern || !sourceText) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      new MatchPreviewService()
        .invoke({ sourceText, mainParam: pattern, configParams: { caseSensitive, splitMatches } } as MatchPreviewConfig, false)
        .then((result) => {
          if (!active) return;
          setPreview(result.result as MatchPreviewData);
          setCurrentIndex(0);
          setPreviewError(null);
        })
        .catch((error) => {
          if (!active || isSuperseded(error)) return;
          setPreview(null);
          setPreviewError(error);
        });
    }, PREVIEW_DELAY_MS);

    return () => {
      active = false;
      clearTimeout(timer);
      BaseService.cancelPending('preview');
    };
  }, [sourceText, pattern, caseSensitive, splitMatches]);

  /** No stale or seemingly binding preview: errors replace the matches with a note (for the current engine) */
  function previewErrorNote(error: unknown): string {
    if (error instanceof ProcessingError) {
      // A JS syntax error says nothing about the Rust dialect, which validates the pattern itself
      if (error.message === ERROR_KEYS.invalidRegex && engine === 'rust') return t('textFilter.previewNotes.notSupportedByJs');
      // The surrogate verdict is about the JS RegExp: it holds for the JS Filter, the Rust Filter matches differently
      if (error.message === ERROR_KEYS.regexSplitsCharacter) return t(engine === 'rust' ? 'textFilter.previewNotes.splitsCharacterRust' : 'textFilter.previewNotes.splitsCharacter');
      if (error.kind === 'timeout') return t('textFilter.previewNotes.tooComplex');
    }
    return processingErrorMessage(error, t);
  }

  const engineNote = engine === 'rust' && <span className="preview-note">{t('textFilter.previewNotes.jsEngine')}</span>;

  if (previewError) {
    return (
      <div className="match-preview">
        <span className="preview-note error">{previewErrorNote(previewError)}</span>
        {engineNote}
      </div>
    );
  }

  if (!preview) return null;
  if (preview.rows.length === 0) {
    // Only claim "no matches" for a complete search
    return (
      <div className="match-preview">
        <span className="preview-note">{t(preview.complete ? 'textFilter.previewInfo.noMatches' : 'textFilter.previewNotes.incomplete', PREVIEW_LIMITS)}</span>
        {engineNote}
      </div>
    );
  }

  const index = Math.min(currentIndex, preview.rows.length - 1);
  const row = preview.rows[index];
  const total = preview.rows.length;

  return (
    <div className="match-preview" title={t('textFilter.previewInfo.matchesOnly')}>
      {engineNote}
      {preview.keepSplitCutsCharacter && (
        <span className="preview-note warning">
          {t(engine === 'rust' ? 'textFilter.previewNotes.keepSplitCutsCharacterRust' : 'textFilter.previewNotes.keepSplitCutsCharacter')}
        </span>
      )}
      {!preview.complete && <span className="preview-note incomplete">{t('textFilter.previewNotes.incomplete', PREVIEW_LIMITS)}</span>}
      <div className="preview-content">{renderRow(row, t)}</div>
      <div className="preview-controls">
        <span className="match-count">
          {t('textFilter.previewInfo.position', { line: row.line, current: index + 1, total })}
          {' · '}
          {t(preview.complete ? 'textFilter.previewInfo.summary' : 'textFilter.previewInfo.summaryIncomplete', { matches: preview.matches, count: total })}
        </span>
        <button onClick={() => setCurrentIndex(index - 1)} disabled={index === 0} title={t('textFilter.previewInfo.previous')}>
          ⬅
        </button>
        <button onClick={() => setCurrentIndex(index + 1)} disabled={index === total - 1} title={t('textFilter.previewInfo.next')}>
          ➡
        </button>
      </div>
    </div>
  );
}

/** Even indexes: text between the matches, odd indexes: matches. Omitted text is shown as a marker, never silently. */
function renderRow(row: PreviewRow, t: (key: string, options?: Record<string, unknown>) => string) {
  const parts = row.segments.map((segment, idx) => {
    const className = idx % 2 === 1 ? 'match-highlight' : 'match-text';
    const elision = row.elided.find((e) => e.segment === idx);
    if (!elision) return segment ? <span key={idx} className={className}>{segment}</span> : null;
    return (
      <span key={idx} className={className}>
        {segment.slice(0, elision.at)}
        <span className="preview-elision">{t('textFilter.previewInfo.elided', { count: elision.omitted })}</span>
        {segment.slice(elision.at)}
      </span>
    );
  });
  if (row.restOmitted) {
    parts.push(
      <span key="rest" className="preview-elision">
        {t('textFilter.previewInfo.rowCut', { count: row.restOmitted })}
      </span>
    );
  }
  return parts;
}
