/** What a file import changes in its target (one text field). */
export interface FileImportTarget {
  /** Replaces the text with the content read (exactly, also ''). */
  setText: (text: string) => void;
  /** The current import failed: report it (the text stays). */
  onError: () => void;
  /** An import of this target starts (true) or the current one ended (false). */
  onLoadingChange: (loading: boolean) => void;
}

export interface FileImporter {
  /** Reads `file` as text into the target; replaces a running import of the same target. */
  importFile: (file: Blob) => void;
  /** The target exists (again), e.g. after a remount. */
  activate: () => void;
  /** The target is gone: a running import changes nothing and reports nothing. */
  dispose: () => void;
}

/**
 * Import jobs of one text target, latest import wins (Paket 11 C2, D9/D12): every import gets a generation; only the
 * latest one of the target may set the text, report its error and end the loading state. A replaced import is ignored
 * completely, also when it finishes after its successor. Reading and decoding stay `FileReader.readAsText`.
 */
export function createFileImporter(target: FileImportTarget): FileImporter {
  let generation = 0;
  let active = true;

  return {
    importFile(file) {
      const job = ++generation;
      const isCurrent = () => active && job === generation;
      const end = (failed: boolean) => {
        if (!isCurrent()) return;
        if (failed) target.onError();
        target.onLoadingChange(false);
      };
      target.onLoadingChange(true);

      const reader = new FileReader();
      reader.onload = () => {
        // readAsText delivers a string on success; an empty file (or only a BOM) is the valid content ''
        if (isCurrent() && typeof reader.result === 'string') target.setText(reader.result);
        end(false);
      };
      // A failed read keeps the current text
      reader.onerror = () => end(true);
      try {
        reader.readAsText(file);
      } catch {
        end(true);
      }
    },
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      generation++;
    },
  };
}
