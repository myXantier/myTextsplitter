/** Largest file that can be imported: 10 MiB, measured in file bytes (`file.size`); exactly 10 MiB is allowed. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * Why an import failed. `unsupportedExtension` and `tooLarge` refuse a file before it is read (no import job);
 * `invalidEncoding` and `readError` end a started import.
 */
export type FileImportError = 'unsupportedExtension' | 'tooLarge' | 'invalidEncoding' | 'readError';

/** The file content is not valid text in a supported encoding (UTF-8 with or without BOM, UTF-16LE/BE with BOM). */
export class InvalidEncodingError extends Error {
  readonly encoding: string;
  constructor(encoding: string) {
    super(`The file is not valid ${encoding}`);
    this.name = 'InvalidEncodingError';
    this.encoding = encoding;
  }
}

/**
 * Decodes the bytes of a text file strictly (Paket 11 C3, D3-D6): the BOM selects UTF-8, UTF-16LE or UTF-16BE and is
 * removed once (a second U+FEFF is content); without a BOM the bytes are UTF-8 (no other detection). Invalid or
 * incomplete sequences, also an odd byte count in UTF-16, throw `InvalidEncodingError`: nothing is replaced by U+FFFD
 * and no byte is dropped. A valid encoded U+FFFD stays.
 */
export function decodeText(bytes: Uint8Array): string {
  let encoding = 'utf-8';
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) [encoding, start] = ['utf-16le', 2];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) [encoding, start] = ['utf-16be', 2];
  try {
    // ignoreBOM: the signature is already skipped, a further U+FEFF is kept as content; subarray copies nothing
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(start));
  } catch {
    throw new InvalidEncodingError(encoding);
  }
}

/** Checks a chosen or dropped file before it is read (D7, D8): `.txt` in any case, at most 10 MiB. */
export function checkImportFile(file: { name: string; size: number }): FileImportError | null {
  if (!/\.txt$/i.test(file.name)) return 'unsupportedExtension';
  if (file.size > MAX_IMPORT_BYTES) return 'tooLarge';
  return null;
}

/** What a file import changes in its target (one text field). */
export interface FileImportTarget {
  /** Replaces the text with the content read (exactly, also ''). */
  setText: (text: string) => void;
  /** A file was refused or the current import failed: report it (the text stays). */
  onError: (error: FileImportError) => void;
  /** An import of this target starts (true) or the current one ended (false). */
  onLoadingChange: (loading: boolean) => void;
}

export interface FileImporter {
  /**
   * Imports `file` into the target. A refused file (extension, size) is reported and starts no job: a running import
   * stays the current one. An accepted file replaces a running import of the same target.
   */
  importFile: (file: File) => void;
  /** The target exists (again), e.g. after a remount. */
  activate: () => void;
  /** The target is gone: a running import changes nothing and reports nothing. */
  dispose: () => void;
}

/**
 * Import jobs of one text target, latest import wins (Paket 11 C2, D9/D12): every accepted import gets a generation;
 * only the latest one of the target may set the text, report its error and end the loading state. A replaced import is
 * ignored completely, also when its read or its decoding finishes after its successor. The file is read as bytes
 * (`readAsArrayBuffer`) and decoded by `decodeText` (C3).
 */
export function createFileImporter(target: FileImportTarget): FileImporter {
  let generation = 0;
  let active = true;

  return {
    importFile(file) {
      const refused = checkImportFile(file);
      if (refused) {
        if (active) target.onError(refused);
        return;
      }
      const job = ++generation;
      const isCurrent = () => active && job === generation;
      const end = (error: FileImportError | null) => {
        if (!isCurrent()) return;
        if (error) target.onError(error);
        target.onLoadingChange(false);
      };
      target.onLoadingChange(true);

      const reader = new FileReader();
      reader.onload = () => {
        if (!isCurrent()) return;
        if (!(reader.result instanceof ArrayBuffer)) return end('readError');
        let text: string;
        try {
          text = decodeText(new Uint8Array(reader.result));
        } catch {
          return end('invalidEncoding');
        }
        target.setText(text);
        end(null);
      };
      // A failed read keeps the current text
      reader.onerror = () => end('readError');
      try {
        reader.readAsArrayBuffer(file);
      } catch {
        end('readError');
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
