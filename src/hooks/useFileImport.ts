import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSnackbar from './useSnackbar';
import { createFileImporter, FileImportError } from '../utils/fileImport';

/** One message per import error, the same for the Open File button and the drop (Paket 11 C3). */
const ERROR_MESSAGES: Record<FileImportError, string> = {
  unsupportedExtension: 'notifications.unsupportedFileType',
  tooLarge: 'notifications.fileTooLarge',
  invalidEncoding: 'notifications.invalidEncoding',
  readError: 'notifications.readError',
};

/** Import state of one text target, handed to the "Open File" button, a drop zone and the textarea. */
export interface FileImport {
  /** The current import of the target is being read. */
  loading: boolean;
  /** Imports a chosen or dropped file into the target (latest import wins; a refused file starts no import). */
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
  const onError = (error: FileImportError) => snackbar.error(t(ERROR_MESSAGES[error]));
  const latest = useRef({ setText, onError });
  latest.current = { setText, onError };

  const [importer] = useState(() =>
    createFileImporter({
      setText: (text) => latest.current.setText(text),
      onError: (error) => latest.current.onError(error),
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
