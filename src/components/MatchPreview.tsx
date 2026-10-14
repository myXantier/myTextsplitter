import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchPreviewService } from '../services/Services';
import { BaseService } from '../services/BaseService';
import { ERROR_KEYS, ProcessingError, isSuperseded, processingErrorMessage } from '../services/ProcessingError';
import './styles/MatchPreviewStyle.css';

interface MatchPreviewProps {
  sourceText: string;
  pattern: string;
  caseSensitive: boolean;
  /** Engine of the actual Filter processing. The preview itself always uses the JS RegExp (MatchPreviewService). */
  engine: 'js' | 'rust';
}

/** The preview job starts when typing pauses */
const PREVIEW_DELAY_MS = 250;

/**
 * Highlights the matches of the Filter pattern line by line. The regex runs in the preview worker (never in the
 * UI thread); a running preview is stopped when the pattern/text changes or the preview is closed.
 */
export function MatchPreview({ sourceText, pattern, caseSensitive, engine }: MatchPreviewProps) {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<string[][]>([]);
  // The error, not its note: the note depends on the engine, which can change without a new preview run
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!pattern || !sourceText) {
      setMatches([]);
      setPreviewError(null);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      new MatchPreviewService()
        .invoke({ sourceText, mainParam: pattern, configParams: { caseSensitive } } as MatchPreviewConfig, false)
        .then((result) => {
          if (!active) return;
          setMatches(result.result as string[][]);
          setCurrentIndex(0);
          setPreviewError(null);
        })
        .catch((error) => {
          if (!active || isSuperseded(error)) return;
          setMatches([]);
          setPreviewError(error);
        });
    }, PREVIEW_DELAY_MS);

    return () => {
      active = false;
      clearTimeout(timer);
      BaseService.cancelPending('preview');
    };
  }, [sourceText, pattern, caseSensitive]);

  /** No stale or seemingly binding preview: errors replace the matches with a note (for the current engine) */
  function previewErrorNote(error: unknown): string {
    if (error instanceof ProcessingError) {
      // A JS syntax error says nothing about the Rust dialect, which validates the pattern itself
      if (error.message === ERROR_KEYS.invalidRegex && engine === 'rust') return t('textFilter.previewNotes.notSupportedByJs');
      if (error.kind === 'timeout') return t('textFilter.previewNotes.tooComplex');
    }
    return processingErrorMessage(error, t);
  }

  if (previewError) {
    return (
      <div className="match-preview">
        <span className="preview-note error">{previewErrorNote(previewError)}</span>
      </div>
    );
  }

  if (matches.length === 0) return null;
  const segments = matches[currentIndex] ?? matches[0];

  return (
    <div className="match-preview">
      {engine === 'rust' && <span className="preview-note">{t('textFilter.previewNotes.jsEngine')}</span>}
      <div className="preview-content">
        {/* Even indexes: text between the matches, odd indexes: matches (findMatchSegments) */}
        {segments.map((part, idx) => (
          <span key={idx} className={idx % 2 === 1 ? 'match-highlight' : 'match-text'}>
            {part}
          </span>
        ))}
      </div>
      <div className="preview-controls">
        <span className="match-count">
          {currentIndex + 1} / {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </span>
        <button
          onClick={() => setCurrentIndex((prev) => (prev > 0 ? prev - 1 : matches.length - 1))}
          disabled={matches.length === 0 || currentIndex === 0}
        >
          ⬅
        </button>
        <button
          onClick={() => setCurrentIndex((prev) => (prev < matches.length - 1 ? prev + 1 : 0))}
          disabled={matches.length === 0 || currentIndex === matches.length - 1}
        >
          ➡
        </button>
      </div>
    </div>
  );
}
