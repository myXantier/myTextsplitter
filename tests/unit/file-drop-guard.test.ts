// App-wide file drop guard (Paket 11 C4B, src/utils/fileDropGuard.ts): file drags outside a file drop zone get the
// operation 'none' (no drop, no navigation to the file), drags without files and drags over a zone are left alone,
// nothing stops the propagation, and the listeners are removed again (React StrictMode mounts twice). The events here
// are plain stand-ins; real drags in the browser and in WebView2 are checked by `checkFileIo` (E2E), and a native
// Explorer drop only by the manual Windows test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { installFileDropGuard, isFileDrag, FILE_DROP_ZONE_ATTRIBUTE } = await import('../../src/utils/fileDropGuard.ts');

/** Window stand-in that records its listeners; `closest` decides whether the event target is inside a drop zone. */
class FakeWindow extends EventTarget {
  inZone = false;
  listeners = new Map<string, number>();
  addEventListener(type: string, listener: any, options?: any) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: any, options?: any) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1);
    super.removeEventListener(type, listener, options);
  }
  closest(selector: string) {
    assert.equal(selector, `[${FILE_DROP_ZONE_ATTRIBUTE}]`);
    return this.inZone ? this : null;
  }
}

/** A drag event with the given data types; `dropEffect` starts as the browser default for an external file drag. */
function dragEvent(type: string, types: string[]) {
  const event = new Event(type, { cancelable: true, bubbles: true }) as Event & { dataTransfer: { types: string[]; dropEffect: string } };
  Object.defineProperty(event, 'dataTransfer', { value: { types, dropEffect: 'copy' } });
  return event;
}

/** Dispatches `event` and reports whether it was cancelled and whether a later listener still saw it. */
function dispatch(win: FakeWindow, event: ReturnType<typeof dragEvent>) {
  let reachedLater = false;
  const later = () => (reachedLater = true);
  win.addEventListener(event.type, later);
  win.dispatchEvent(event);
  win.removeEventListener(event.type, later);
  return { prevented: event.defaultPrevented, dropEffect: event.dataTransfer.dropEffect, reachedLater };
}

test('file drop guard: a file drag outside a drop zone gets no drop and opens nothing', () => {
  const win = new FakeWindow();
  installFileDropGuard(win as any);
  assert.deepEqual(dispatch(win, dragEvent('dragover', ['Files'])), { prevented: true, dropEffect: 'none', reachedLater: true });
  assert.deepEqual(dispatch(win, dragEvent('drop', ['Files'])), { prevented: true, dropEffect: 'copy', reachedLater: true });
});

test('file drop guard: a file drag over a drop zone is left to the zone', () => {
  const win = new FakeWindow();
  win.inZone = true;
  installFileDropGuard(win as any);
  assert.deepEqual(dispatch(win, dragEvent('dragover', ['Files'])), { prevented: false, dropEffect: 'copy', reachedLater: true });
  assert.deepEqual(dispatch(win, dragEvent('drop', ['Files'])), { prevented: false, dropEffect: 'copy', reachedLater: true });
});

test('file drop guard: drags without files (text, in-page column moves) are not touched', () => {
  const win = new FakeWindow();
  installFileDropGuard(win as any);
  for (const types of [['text/plain'], ['text/plain', 'text/html'], []]) {
    assert.deepEqual(dispatch(win, dragEvent('dragover', types)), { prevented: false, dropEffect: 'copy', reachedLater: true }, JSON.stringify(types));
    assert.deepEqual(dispatch(win, dragEvent('drop', types)), { prevented: false, dropEffect: 'copy', reachedLater: true }, JSON.stringify(types));
  }
  assert.equal(isFileDrag(dragEvent('drop', ['text/plain', 'Files']) as any), true);
  assert.equal(isFileDrag(new Event('drop') as any), false, 'no dataTransfer');
});

test('file drop guard: removed again, a StrictMode remount leaves exactly one pair of listeners', () => {
  const win = new FakeWindow();
  const cleanup = installFileDropGuard(win as any);
  assert.deepEqual(Object.fromEntries(win.listeners), { dragover: 1, drop: 1 });
  cleanup();
  assert.deepEqual(Object.fromEntries(win.listeners), { dragover: 0, drop: 0 });
  assert.deepEqual(dispatch(win, dragEvent('dragover', ['Files'])), { prevented: false, dropEffect: 'copy', reachedLater: true }, 'no effect after cleanup');

  // StrictMode: effect, cleanup, effect again
  const first = installFileDropGuard(win as any);
  first();
  installFileDropGuard(win as any);
  assert.deepEqual(Object.fromEntries(win.listeners), { dragover: 1, drop: 1 });
  assert.equal(dispatch(win, dragEvent('dragover', ['Files'])).dropEffect, 'none');
});
