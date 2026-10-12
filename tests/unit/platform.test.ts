// Unit tests for platform detection, window/keyboard helpers and browser settings persistence.
// Run with `npm test` (Node >= 22.18 / 23.6, native TypeScript type stripping, no extra dependencies).
// No browser and no Tauri runtime: `window`/`document` are minimal in-memory stand-ins.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isDesktop,
  getAppWindow,
  listenSafely,
  disableWebFunctions,
  shouldDisableWebFunctions,
} from '../../src/platform/platform.ts';
import {
  BROWSER_SETTINGS_KEY,
  permanentSettingsSchema,
  sanitizeSettings,
  loadBrowserSettings,
  saveBrowserSettings,
  loadPersistedSettings,
  savePersistedSettings,
} from '../../src/platform/settingsStorage.ts';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

const validSettings = {
  isDarkMode: false,
  language: 'de',
  trimLine: true,
  trimParts: false,
  fontSize: 'text-lg',
  showLineNumbers: true,
  showEmptyLines: false,
  savedPatterns: ['a', 'b'],
};

const g = globalThis as any;
const asStorage = (s: unknown) => s as Storage;

function silenceWarnings(fn: () => void | Promise<void>) {
  return async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await fn();
    } finally {
      console.warn = originalWarn;
    }
  };
}

function keyEvent(key: string, ctrlKey = false) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key, ctrlKey });
  return event;
}

beforeEach(() => {
  // Plain browser: a window object without the Tauri runtime marker
  g.window = { location: { hostname: 'localhost' }, localStorage: new MemoryStorage() };
  g.document = new EventTarget();
});

// --- Platform detection ---

test('isDesktop is false without Tauri runtime', () => {
  assert.equal(isDesktop(), false);
});

test('isDesktop follows the official Tauri runtime marker', () => {
  g.window.isTauri = true;
  assert.equal(isDesktop(), true);
});

test('getAppWindow returns null in the browser instead of throwing', () => {
  assert.equal(getAppWindow(), null);
});

test('web shortcuts are never blocked in the browser', () => {
  g.window.location.hostname = 'example.org';
  assert.equal(shouldDisableWebFunctions('Windows'), false);
  assert.equal(shouldDisableWebFunctions('Linux'), false);
});

test('web shortcuts keep the desktop rule', () => {
  g.window.isTauri = true;
  assert.equal(shouldDisableWebFunctions('Windows'), false); // dev server on localhost
  assert.equal(shouldDisableWebFunctions('Linux'), true);
  g.window.location.hostname = 'tauri.localhost';
  assert.equal(shouldDisableWebFunctions('Windows'), true);
});

// --- Window listeners ---

test('listenSafely unregisters a listener that resolves after cleanup (StrictMode)', async () => {
  let unlistenCalls = 0;
  let resolveRegistration!: (fn: () => void) => void;
  const cleanup = listenSafely(() => new Promise((resolve) => (resolveRegistration = resolve)));

  cleanup();
  resolveRegistration(() => unlistenCalls++);
  await new Promise((r) => setImmediate(r));

  assert.equal(unlistenCalls, 1);
});

test(
  'listenSafely unregisters after resolution and survives a rejected registration',
  silenceWarnings(async () => {
    let unlistenCalls = 0;
    const cleanup = listenSafely(async () => () => unlistenCalls++);
    await new Promise((r) => setImmediate(r));
    cleanup();
    assert.equal(unlistenCalls, 1);

    const failing = listenSafely(() => Promise.reject(new Error('no runtime')));
    await new Promise((r) => setImmediate(r));
    failing();
  })
);

// --- Keyboard / context menu blocking ---

test('disableWebFunctions blocks the desktop shortcuts and the context menu', () => {
  disableWebFunctions();

  for (const [key, ctrl] of [['F5', false], ['F3', false], ['F7', false], ['r', true], ['R', true], ['p', true], ['f', true]] as const) {
    const event = keyEvent(key, ctrl);
    g.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, `${ctrl ? 'Ctrl+' : ''}${key} must be blocked`);
  }
  for (const key of ['r', 'p', 'f', 'a', 'Enter']) {
    const event = keyEvent(key);
    g.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `plain ${key} must not be blocked`);
  }

  const contextMenu = new Event('contextmenu', { cancelable: true });
  g.document.dispatchEvent(contextMenu);
  assert.equal(contextMenu.defaultPrevented, true);
});

test('disableWebFunctions cleanup removes only its own handlers', () => {
  const foreignKeys: string[] = [];
  g.document.addEventListener('keydown', (e: Event) => foreignKeys.push((e as KeyboardEvent).key));
  g.document.onkeydown = () => {}; // a handler set by someone else must survive the cleanup

  const cleanup = disableWebFunctions();
  cleanup();

  const keydown = keyEvent('F5');
  g.document.dispatchEvent(keydown);
  const contextMenu = new Event('contextmenu', { cancelable: true });
  g.document.dispatchEvent(contextMenu);

  assert.equal(keydown.defaultPrevented, false);
  assert.equal(contextMenu.defaultPrevented, false);
  assert.deepEqual(foreignKeys, ['F5']);
  assert.equal(typeof g.document.onkeydown, 'function');
});

// --- Settings validation ---

test('sanitizeSettings accepts a complete valid settings object', () => {
  assert.deepEqual(sanitizeSettings(validSettings, permanentSettingsSchema), validSettings);
});

test('sanitizeSettings drops unknown keys, wrong types and null values', () => {
  const raw = {
    isDarkMode: 'false', // string instead of boolean
    language: 42,
    trimLine: null,
    trimParts: true,
    fontSize: 'text-lg',
    showLineNumbers: 1,
    showEmptyLines: {},
    savedPatterns: 'not-an-array',
    unknown: 'x',
    windowSize: [1200, 800], // desktop-only, not part of the browser settings
  };
  assert.deepEqual(sanitizeSettings(raw, permanentSettingsSchema), { trimParts: true, fontSize: 'text-lg' });
});

test('sanitizeSettings rejects values outside the allowed unions', () => {
  const raw = { language: 'fr', fontSize: 'text-9xl' };
  assert.deepEqual(sanitizeSettings(raw, permanentSettingsSchema), {});
  // Inherited object keys are not valid enum values
  assert.deepEqual(sanitizeSettings({ language: 'toString', fontSize: '__proto__' }, permanentSettingsSchema), {});
});

test('sanitizeSettings keeps only string elements of savedPatterns', () => {
  const raw = { savedPatterns: ['a', null, 1, { x: 1 }, ['nested'], 'b', true] };
  assert.deepEqual(sanitizeSettings(raw, permanentSettingsSchema), { savedPatterns: ['a', 'b'] });
});

test('sanitizeSettings handles non-object roots', () => {
  for (const raw of [null, undefined, 0, 'text', true, [1, 2], []]) {
    assert.deepEqual(sanitizeSettings(raw, permanentSettingsSchema), {}, JSON.stringify(raw));
  }
});

test('sanitizeSettings ignores inherited properties', () => {
  const raw = Object.create({ isDarkMode: false });
  assert.deepEqual(sanitizeSettings(raw, permanentSettingsSchema), {});
});

// --- Browser persistence ---

test('browser settings survive a save/load round trip', () => {
  const storage = asStorage(new MemoryStorage());
  saveBrowserSettings(validSettings, storage);
  assert.deepEqual(loadBrowserSettings(permanentSettingsSchema, storage), validSettings);
});

test('first browser start has no stored settings', () => {
  assert.equal(loadBrowserSettings(permanentSettingsSchema, asStorage(new MemoryStorage())), null);
});

test(
  'corrupt stored JSON does not throw',
  silenceWarnings(() => {
    const storage = new MemoryStorage();
    for (const stored of ['{not json', '', 'undefined', '{"isDarkMode":']) {
      storage.setItem(BROWSER_SETTINGS_KEY, stored);
      assert.equal(loadBrowserSettings(permanentSettingsSchema, asStorage(storage)), null, stored);
    }
    // Valid JSON of the wrong shape yields no settings (defaults stay in effect)
    for (const stored of ['null', '42', '"text"', '[]', '{"isDarkMode":"yes"}']) {
      storage.setItem(BROWSER_SETTINGS_KEY, stored);
      const loaded = loadBrowserSettings(permanentSettingsSchema, asStorage(storage));
      assert.deepEqual(loaded, {}, stored);
    }
  })
);

test(
  'inaccessible browser storage does not throw',
  silenceWarnings(() => {
    const broken = asStorage({
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    });
    assert.equal(loadBrowserSettings(permanentSettingsSchema, broken), null);
    assert.doesNotThrow(() => saveBrowserSettings(validSettings, broken));

    // window.localStorage getter itself throwing (blocked site data)
    g.window = {
      location: { hostname: 'localhost' },
      get localStorage() {
        throw new Error('SecurityError');
      },
    };
    assert.equal(loadBrowserSettings(permanentSettingsSchema), null);
    assert.doesNotThrow(() => saveBrowserSettings(validSettings));
  })
);

test('persisted settings use localStorage in the browser', async () => {
  assert.equal(await loadPersistedSettings(permanentSettingsSchema), null);
  await savePersistedSettings(validSettings);
  assert.equal(g.window.localStorage.data.has(BROWSER_SETTINGS_KEY), true);
  assert.deepEqual(await loadPersistedSettings(permanentSettingsSchema), validSettings);
});
