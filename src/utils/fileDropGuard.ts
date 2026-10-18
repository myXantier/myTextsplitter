/** Attribute of an element that accepts dropped files (set by useDragAndDrop on its drop zone). */
export const FILE_DROP_ZONE_ATTRIBUTE = 'data-file-drop-zone';

/** A drag that carries files from outside the page (Explorer, desktop); in-page and text drags carry no 'Files'. */
export const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

const inDropZone = (event: DragEvent) =>
  !!(event.target as Element | null)?.closest?.(`[${FILE_DROP_ZONE_ATTRIBUTE}]`);

/**
 * Ignores files dragged anywhere outside a file drop zone (Paket 11 C4B): the WebView would otherwise open the dropped
 * file (navigation, the app state is lost), and other drop targets (e.g. the result columns) would get a file drop.
 * Capture phase on the window, before every element: outside a zone the drag gets the operation 'none', so no drop
 * happens; inside a zone nothing is changed and the zone's own handler gets the real drop. Only file drags are touched,
 * nothing stops the propagation. Returns the function that removes the listeners.
 */
export function installFileDropGuard(target: Pick<Window, 'addEventListener' | 'removeEventListener'>) {
  const onDragOver = (event: DragEvent) => {
    if (!isFileDrag(event) || inDropZone(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  // Safety net: a file drop that still happens outside a zone must not open the file
  const onDrop = (event: DragEvent) => {
    if (isFileDrag(event) && !inDropZone(event)) event.preventDefault();
  };
  // Object form: the same capture flag for adding and removing in every environment
  const CAPTURE = { capture: true };
  target.addEventListener('dragover', onDragOver as EventListener, CAPTURE);
  target.addEventListener('drop', onDrop as EventListener, CAPTURE);
  return () => {
    target.removeEventListener('dragover', onDragOver as EventListener, CAPTURE);
    target.removeEventListener('drop', onDrop as EventListener, CAPTURE);
  };
}
