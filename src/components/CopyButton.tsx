import { useState, useCallback, useRef } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fontSizeToIconSize } from '../utils/helper';
import { useSettings, usePermanentSetting } from '../hooks/useSettings';
import useSnackbar from '../hooks/useSnackbar';
import './styles/CopyButtonStyle.css';

interface CopyButtonProps {
  toCopy: string;
  className?: string;
}

export default function CopyButton({ toCopy, className }: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const snackbar = useSnackbar();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation();
  const fontSize = usePermanentSetting('fontSize');

  const handleCopy = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    
    navigator.clipboard
      .writeText(toCopy)
      .then(() => {
        setIsCopied(true);
        timer.current = setTimeout(() => setIsCopied(false), 2000);
        snackbar.success(t('notifications.copied'))
      })
      .catch(() => {
        snackbar.error(t('notifications.copyError'))
      });
  }, [toCopy, snackbar]);

  return (
    <button
      onClick={handleCopy}
      disabled={!toCopy}
      className={`copy-button ${className} ${fontSize} ${isCopied ? 'copied' : ''}`}
      title={t(isCopied ? 'actions.copied' : 'actions.copy')}
    >
      {isCopied ? (
        <>
          <Check size={fontSizeToIconSize[fontSize]} />
          <span>{t('actions.copied')}</span>
        </>
      ) : (
        <>
          <Copy size={fontSizeToIconSize[fontSize]} />
          <span>{t('actions.copy')}</span>
        </>
      )}
    </button>
  );
}