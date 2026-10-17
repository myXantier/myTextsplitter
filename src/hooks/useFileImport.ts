import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSnackbar from './useSnackbar';
import { createFileImporter } from '../utils/fileImport';

/** Import state of one text target, handed to the "Open File" button, a drop zone and the textarea. */
export interface FileImport {
  /** The current import of the target is being read. */
  loading: boolean;
  /** Imports a chosen or dropped file into the target (latest import wins). */
  importFile: (file: File) => void;
}

/**
 * File import into the text state `setText` (Paket 11 C2). Lives next to that state: the shared source text in PageList
 * (so the import and its lock survive a page change), the new Diff text in DiffPage (its import ends with the page).
 */
export function useFileImport(setText: (text: string) => void): FileImport {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const [loading, setLoading] = useState(false);
  // Latest callbacks for imports that finish after a re-render
  const latest = useRef({ setText, onError: () => snackbar.error(t('notifications.readError')) });
  latest.current = { setText, onError: () => snackbar.error(t('notifications.readError')) };

  const [importer] = useState(() =>
    createFileImporter({
      setText: (text) => latest.current.setText(text),
      onError: () => latest.current.onError(),
      onLoadingChange: setLoading,
    })
  );
  // Unmount: a running import neither sets a text nor shows a message (StrictMode mounts twice, so activate again)
  useEffect(() => {
    importer.activate();
    return () => importer.dispose();
  }, [importer]);

  return { loading, importFile: importer.importFile };
}

/** Attributes of a textarea while its import runs: readOnly (selecting and copying stay possible, not disabled). */
export const importingTextareaProps = (fileImport: FileImport) => ({
  readOnly: fileImport.loading,
  'aria-busy': fileImport.loading || undefined,
});
