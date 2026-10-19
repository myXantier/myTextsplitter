import { useTranslation } from 'react-i18next';
import './styles/OutdatedNoticeStyle.css';

interface OutdatedNoticeProps {
  /** Derived on render (request of the shown result vs. the current input), never a stored flag */
  outdated: boolean;
  /** Id of the visible notice (`useId`); the result refers to it while outdated (`outdatedDescribedBy`) */
  id: string;
  /** Page-specific explanation after the common short text (default: `results.outdatedHint`) */
  hint?: string;
  /** Extra class of the visible notice, which only exists while the result is outdated */
  className?: string;
}

/**
 * Status of a shown result (Paket 12 C2). The live region stays mounted as long as the result is shown and is empty while
 * the result is current; the notice is inserted when the result becomes outdated and removed when it is current again,
 * so a screen reader announces each change of the status once (not every keystroke). Goes into the result header; the
 * result itself stays visible, selectable and copyable.
 */
export function OutdatedNotice({ outdated, id, hint, className }: OutdatedNoticeProps) {
  const { t } = useTranslation();
  return (
    <span className="result-status" role="status" aria-live="polite">
      {outdated && (
        <span id={id} className={`result-outdated-notice ${className ?? ''}`}>
          <strong>{t('results.outdated')}</strong> – {hint ?? t('results.outdatedHint')}
        </span>
      )}
    </span>
  );
}

/** `aria-describedby` of the result: its own description (if any) and, only while outdated, the notice. */
export const outdatedDescribedBy = (outdated: boolean, id: string, own?: string) =>
  [own, outdated ? id : undefined].filter(Boolean).join(' ') || undefined;
