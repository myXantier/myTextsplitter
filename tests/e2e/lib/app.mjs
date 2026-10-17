// DOM helpers for driving the myTextsplitter UI through CDP (installed as `window.__t` in the page).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectedErrorsIn, withoutExpected } from './harness.mjs';

export const APP_HELPERS = `window.__t = {
  /** Currently visible page container */
  page: () => document.querySelector('.app-container-column:not(.hide-page)'),
  /** Sets the value of a React-controlled input/textarea */
  set(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  nav(name) { document.querySelector('a[page-name="' + name + '"]').click(); },
  textareas: () => [...__t.page().querySelectorAll('textarea')],
  snacks: () => [...document.querySelectorAll('.snackbar-message')].map(e => e.className.split(' ')[1] + ': ' + e.innerText.trim()),
  status() { const s = __t.page()?.querySelector('.processing-status'); return s ? s.innerText.replace(/\\s+/g, ' ').trim() : null; },
  /** Split result as column-major array (values of the rendered rows; fine for small results) */
  columns: () => [...__t.page().querySelectorAll('.result-column')].map(c => [...c.querySelectorAll('.virtualized-input')].map(i => i.value)),
  combined: () => __t.page().querySelector('.combine-textarea')?.value ?? null,
  /** Records every snackbar shown from now on (also ones that disappear again); read + reset with takeSnacks() */
  watchSnacks() {
    __t.snackLog = [];
    if (__t.snackObserver) return;
    __t.snackObserver = new MutationObserver((mutations) => mutations.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      const found = n.matches('.snackbar-message') ? [n] : [...n.querySelectorAll('.snackbar-message')];
      found.forEach((e) => __t.snackLog.push(e.className.split(' ')[1] + ': ' + e.innerText.trim()));
    })));
    __t.snackObserver.observe(document.body, { childList: true, subtree: true });
  },
  takeSnacks() { const log = __t.snackLog; __t.snackLog = []; return log; },
  /** Value React passes to a controlled textarea: \`textarea.value\` normalizes CRLF/CR to LF, this one does not */
  raw(el) {
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactProps'));
    return key ? el[key].value : null;
  },
  /** Imports \`text\` through the n-th "Open File" button of the page (FileReader keeps CRLF, unlike typing) */
  loadFile(index, text) {
    const input = __t.page().querySelectorAll('.file-upload input[type=file]')[index];
    const files = new DataTransfer();
    files.items.add(new File([text], 'input.txt', { type: 'text/plain' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },
  /** Copy buttons write into __t.copied instead of the system clipboard (restore with releaseCopy) */
  captureCopy() {
    __t.copied = null;
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: (text) => { __t.copied = text; return Promise.resolve(); } });
  },
  releaseCopy() { delete navigator.clipboard.writeText; __t.copied = null; },
  settingsCheckbox(label) {
    return [...document.querySelectorAll('.settings-modal label')].find(l => l.innerText.includes(label)).querySelector('input');
  },
  /** Opens the "Processing Mode" dropdown in the settings modal and returns its options */
  async processingModes() {
    const section = [...document.querySelectorAll('.settings-modal .settings-section')].find(s => s.innerText.includes('Processing'));
    section.querySelector('.custom-select').click();
    await new Promise(r => setTimeout(r, 300));
    const modes = [...document.querySelectorAll('.select-dropdown li')].map(l => l.innerText.trim());
    section.querySelector('.custom-select').click();
    return modes;
  },
}; true`;

/** Installs the helpers (again after every reload) */
export const installHelpers = (page) => page.eval(APP_HELPERS);

// Split cases checked in the integration tests (same expectations as tests/fixtures/split-cases.json).
export const SPLIT_CASES = {
  b1: {
    text: 'A,B\nC,D,E\n\nF,G',
    separator: ',',
    keep: [['A', 'C', '', 'F'], ['B', 'D', '', 'G'], ['', 'E', '', '']],
    skip: [['A', 'C', 'F'], ['B', 'D', 'G'], ['', 'E', '']],
    // Part 3 then Part 1 with separator ':' (keep empty lines)
    combined: ':A\nE:C\n:\n:F',
  },
};

/**
 * Sets text + separator on the Split page, splits and returns the rendered result columns.
 * Waits (max. 5 s) until the result equals `expected`; on timeout the actual result is returned for the report.
 */
export async function splitAndRead(page, text, separator, expected) {
  await page.eval(`__t.nav('split'); true`);
  await new Promise((r) => setTimeout(r, 150));
  // Separate evaluations: React must re-render between the two controlled inputs
  await page.eval(`__t.set(__t.textareas()[0], ${JSON.stringify(text)}); true`);
  await new Promise((r) => setTimeout(r, 150));
  await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(separator)}); true`);
  await new Promise((r) => setTimeout(r, 150));
  await page.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
  await page.waitFor(`JSON.stringify(__t.columns()) === ${JSON.stringify(JSON.stringify(expected))}`, 5000);
  return page.eval('__t.columns()');
}

/** Toggles a checkbox in the settings modal to `value` and closes the modal again. */
export async function setSettingsCheckbox(page, label, value) {
  await page.eval(`document.querySelector('button[title="Settings"]').click(); true`);
  await new Promise((r) => setTimeout(r, 300));
  await page.eval(`(() => { const c = __t.settingsCheckbox(${JSON.stringify(label)}); if (c.checked !== ${value}) c.click(); })(); true`);
  await new Promise((r) => setTimeout(r, 200));
  const checked = await page.eval(`__t.settingsCheckbox(${JSON.stringify(label)}).checked`);
  await page.eval(`document.querySelector('.settings-modal .close-button').click(); true`);
  await new Promise((r) => setTimeout(r, 200));
  return checked;
}

/** Clears the combine result, then combines the given 0-based column indexes in this order. */
export async function combineColumns(page, indexes) {
  await page.eval(`__t.page().querySelector('.combine-clear')?.click(); true`);
  await new Promise((r) => setTimeout(r, 200));
  await page.eval(`document.querySelector('.combine-icon-link').click(); true`);
  await new Promise((r) => setTimeout(r, 300));
  for (const i of indexes) {
    await page.eval(`document.querySelectorAll('.column-button')[${i}]?.click(); true`);
    await new Promise((r) => setTimeout(r, 300));
  }
  const used = await page.eval(`document.querySelectorAll('.column-button-used').length`);
  await page.eval(`document.querySelector('.close-combine-btn')?.click(); true`);
  await new Promise((r) => setTimeout(r, 200));
  return { used, text: await page.eval('__t.combined()') };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Error handling of Filter and Remove (Paket 4) in the current processing mode:
 * invalid regex -> one error message, no success message, previous result kept, processing finished;
 * all lines removed -> empty result reported as success. `errorsSince(n)` returns console errors since log index n.
 */
export async function checkProcessingErrors(page, r, label, errorsSince) {
  const result = () => page.eval(`__t.textareas()[1]?.value ?? null`);
  const finished = () => page.eval(`!!__t.page().querySelector('.mode-toggle')`); // only rendered when not processing
  const setPattern = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  /** Clicks, waits for the first snackbar and returns all snackbars shown meanwhile */
  const run = async (clickExpr) => {
    await page.eval(`__t.watchSnacks(); ${clickExpr}; true`);
    await page.waitFor(`__t.snackLog.length > 0`, 8000);
    await sleepMs(300);
    return page.eval('__t.takeSnacks()');
  };
  const isRegexError = (snacks) => snacks.length === 1 && /^error: .*(regex|regul)/i.test(snacks[0]);

  // --- Filter ---
  const filterKeep = `__t.page().querySelectorAll('.filter-actions button')[1].click()`;
  await page.eval(`__t.nav('filter'); true`);
  await sleepMs(200);
  await page.eval(`__t.set(__t.textareas()[0], 'apple\\nbanana\\napricot'); true`);
  await sleepMs(150);
  await setPattern('ap');
  let snacks = await run(filterKeep);
  const filterBefore = await result();
  r.check(`${label}: Filter valid result`, filterBefore === 'ap\nap' && snacks.every((s) => s.startsWith('success')), `${JSON.stringify(filterBefore)} ${JSON.stringify(snacks)}`);

  let n = page.logs.length;
  await setPattern('([a-');
  snacks = await run(filterKeep);
  r.check(`${label}: Filter invalid regex -> one error message, no success message`, isRegexError(snacks), JSON.stringify(snacks));
  r.check(`${label}: Filter invalid regex -> previous result kept`, (await result()) === filterBefore, JSON.stringify(await result()));
  r.check(`${label}: Filter invalid regex -> processing finished, no console error`, (await finished()) && errorsSince(n).length === 0, JSON.stringify(errorsSince(n)));

  n = page.logs.length;
  await setPattern('zzz');
  snacks = await run(filterKeep);
  r.check(
    `${label}: Filter removing all lines -> empty result reported as success`,
    (await result()) === '' && snacks.length === 1 && snacks[0].startsWith('success') && errorsSince(n).length === 0,
    `${JSON.stringify(await result())} ${JSON.stringify(snacks)}`
  );
  await setPattern('');

  // --- Remove ---
  const regexCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /regex/i.test(e.innerText)).querySelector('input')`;
  const removeContaining = `__t.page().querySelector('.remove-action-button.containing').click()`;
  await page.eval(`__t.nav('remove'); true`);
  await sleepMs(200);
  await page.eval(`__t.set(__t.textareas()[0], 'x\\ny\\nx\\nz'); true`);
  await sleepMs(150);
  snacks = await run(`__t.page().querySelector('.remove-action-button.duplicates').click()`);
  const removeBefore = await result();
  r.check(`${label}: Remove valid result`, removeBefore === 'x\ny\nz', JSON.stringify(removeBefore));

  await page.eval(`${regexCheckbox}.checked || ${regexCheckbox}.click(); true`);
  await sleepMs(150);
  n = page.logs.length;
  await setPattern('([a-');
  snacks = await run(removeContaining);
  r.check(`${label}: Remove invalid regex -> one error message, no success message`, isRegexError(snacks), JSON.stringify(snacks));
  r.check(`${label}: Remove invalid regex -> previous result kept`, (await result()) === removeBefore, JSON.stringify(await result()));
  r.check(`${label}: Remove invalid regex -> processing finished, no console error`, (await finished()) && errorsSince(n).length === 0, JSON.stringify(errorsSince(n)));

  n = page.logs.length;
  await setPattern('x|y|z');
  snacks = await run(removeContaining);
  r.check(
    `${label}: Remove removing all lines -> empty result reported as success`,
    (await result()) === '' && snacks.length === 1 && snacks[0].startsWith('success') && /4/.test(snacks[0]) && errorsSince(n).length === 0,
    `${JSON.stringify(await result())} ${JSON.stringify(snacks)}`
  );
  await page.eval(`${regexCheckbox}.checked && ${regexCheckbox}.click(); true`);
  await setPattern('');

  // --- Remove: the trim option (Paket 8 C3) is labelled for duplicates only, keeps its state across the actions ---
  const trimBox = `[...__t.page().querySelectorAll('.input-box')].find(e => /trim/i.test(e.innerText))`;
  const trimInfo = await page.eval(`JSON.stringify({ text: ${trimBox}.innerText.trim(), title: ${trimBox}.querySelector('label').title, checked: ${trimBox}.querySelector('input').checked })`);
  const trim = JSON.parse(trimInfo);
  r.check(
    `${label}: Remove trim option says it only applies to duplicates (label and tooltip)`,
    /(duplicates only|nur Duplikate)/i.test(trim.text) && /(Duplicates|Duplikate)/.test(trim.title) && /(Containing|Enthaltend)/.test(trim.title),
    trimInfo,
  );
  await page.eval(`${trimBox}.querySelector('input').checked || ${trimBox}.querySelector('input').click(); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.textareas()[0], ' a\\na\\n  b\\nb'); true`);
  await sleepMs(150);
  await setPattern(' a');
  n = page.logs.length;
  snacks = await run(removeContaining);
  const containing = await result();
  const stillChecked = await page.eval(`${trimBox}.querySelector('input').checked`);
  snacks = await run(`__t.page().querySelector('.remove-action-button.duplicates').click()`);
  const duplicates = await result();
  r.check(
    `${label}: Remove trim stays checked across actions, is ignored by Containing and only compares duplicates (original lines kept)`,
    containing === 'a\n  b\nb' && stillChecked && duplicates === ' a\n  b' && snacks.length === 1 && snacks[0].startsWith('success') && errorsSince(n).length === 0,
    `containing=${JSON.stringify(containing)} checked=${stillChecked} duplicates=${JSON.stringify(duplicates)} ${JSON.stringify(snacks)}`,
  );
  await setPattern('');
}

/** Pattern + text with catastrophic backtracking: about two minutes in V8, fancy-regex stops at its backtrack limit. */
const CATASTROPHIC = { pattern: '(a|b|ab)*(?=c)', text: 'ab'.repeat(40) };

/**
 * Regex robustness (Paket 5) in the current processing mode; `engine` = 'js' (Web Worker) or 'rust' (backend):
 * - Filter with a catastrophic regex: the UI stays responsive, exactly one error message (JS: worker timeout,
 *   Rust: backtracking limit), the previous result is kept, and a normal Filter works again afterwards.
 * - Split with the Rust-only pattern `(?i)x`: Rust splits (no JS pre-validation), JS reports the JS syntax error.
 * - Pattern preview: matches highlighted in a worker; Rust mode shows the JS-engine hint; a pattern that JS cannot
 *   compile and a too expensive pattern show a note instead of a (seemingly binding) result.
 */
export async function checkRegexRobustness(page, r, label, errorsSince, engine) {
  const result = () => page.eval(`__t.textareas()[1]?.value ?? null`);
  const finished = () => page.eval(`!!__t.page().querySelector('.mode-toggle')`);
  const exceptionsSince = (n) => errorsSince(n).filter((l) => l.kind === 'exception');
  const setInput = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  const setText = async (value) => {
    await page.eval(`__t.set(__t.textareas()[0], ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  /** Longest answer time of the page (ms) during `ms`: a blocked UI thread cannot answer CDP evaluations */
  const maxLatency = async (ms) => {
    let max = 0;
    for (const end = Date.now() + ms; Date.now() < end; ) {
      const start = Date.now();
      await page.eval('1');
      max = Math.max(max, Date.now() - start);
      await sleepMs(100);
    }
    return max;
  };
  const filterKeep = `__t.page().querySelectorAll('.filter-actions button')[1].click()`;
  const expectedError = engine === 'js' ? /timed out|Zeitüberschreitung/i : /too complex|aufwendig/i;

  // --- Filter: catastrophic regex ---
  await page.eval(`__t.nav('filter'); true`);
  await sleepMs(200);
  await setText('apple\nbanana');
  await setInput('an');
  await page.eval(`__t.watchSnacks(); ${filterKeep}; true`);
  await page.waitFor(`__t.snackLog.length > 0`, 8000);
  const before = await result();
  r.check(`${label}: Filter before the catastrophic regex`, before === 'anan', JSON.stringify(before));

  let n = page.logs.length;
  await setText(CATASTROPHIC.text);
  await setInput(CATASTROPHIC.pattern);
  await page.eval(`__t.watchSnacks(); ${filterKeep}; true`);
  const latency = await maxLatency(1500);
  r.check(`${label}: UI stays responsive during a catastrophic regex`, latency < 1000, `max ${latency} ms`);
  await page.waitFor(`__t.snackLog.length > 0`, 20000);
  await sleepMs(300);
  let snacks = await page.eval('__t.takeSnacks()');
  r.check(
    `${label}: catastrophic regex -> one error message (${engine === 'js' ? 'worker timeout' : 'backtracking limit'})`,
    snacks.length === 1 && snacks[0].startsWith('error') && expectedError.test(snacks[0]),
    JSON.stringify(snacks)
  );
  r.check(`${label}: catastrophic regex -> previous result kept`, (await result()) === before, JSON.stringify(await result()));
  r.check(`${label}: catastrophic regex -> processing finished, no exception`, (await finished()) && exceptionsSince(n).length === 0, JSON.stringify(exceptionsSince(n)));

  n = page.logs.length;
  await setText('apple\nbanana');
  await setInput('an');
  await page.eval(`__t.watchSnacks(); ${filterKeep}; true`);
  await page.waitFor(`__t.snackLog.length > 0`, 8000);
  await sleepMs(300);
  snacks = await page.eval('__t.takeSnacks()');
  r.check(
    `${label}: normal Filter works again after the catastrophic regex`,
    (await result()) === 'anan' && snacks.length === 1 && snacks[0].startsWith('success') && errorsSince(n).length === 0,
    `${JSON.stringify(await result())} ${JSON.stringify(snacks)}`
  );

  // The following checks need a first run that is still running when the second one starts: the JS run of the
  // catastrophic regex lasts until the worker timeout. Rust stops it within a fraction of a second at the
  // backtracking limit (no reliable overlap); the Rust order cases are unit tests (processing.test.ts).
  if (engine === 'js') {
    // --- Two rapid Filter runs: the older (catastrophic) one is superseded, only the newer one reports ---
    n = page.logs.length;
    await setText(CATASTROPHIC.text);
    await setInput(CATASTROPHIC.pattern);
    await page.eval(`__t.watchSnacks(); ${filterKeep}; true`);
    await setText('apple\nbanana');
    await setInput('an');
    await page.eval(`${filterKeep}; true`);
    await page.waitFor(`__t.snackLog.length > 0`, 20000);
    await page.waitFor(`!!__t.page().querySelector('.mode-toggle')`, 20000);
    await sleepMs(500);
    snacks = await page.eval('__t.takeSnacks()');
    r.check(
      `${label}: two rapid Filter runs -> newer result, one success message, no message of the superseded run`,
      (await result()) === 'anan' && snacks.length === 1 && snacks[0].startsWith('success') && exceptionsSince(n).length === 0,
      `${JSON.stringify(await result())} ${JSON.stringify(snacks)}`
    );

    // --- A Split that finishes does not end the processing state of a Filter that is still running ---
    const splitCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /regex/i.test(e.innerText)).querySelector('input')`;
    n = page.logs.length;
    await setText(CATASTROPHIC.text);
    await setInput(CATASTROPHIC.pattern);
    await page.eval(`__t.watchSnacks(); ${filterKeep}; true`);
    await page.eval(`__t.nav('split'); true`);
    await sleepMs(200);
    await page.eval(`${splitCheckbox}.checked && ${splitCheckbox}.click(); true`);
    await setText('a_b');
    await setInput('_');
    await page.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
    const splitDone = await page.waitFor(`JSON.stringify(__t.columns()) === ${JSON.stringify(JSON.stringify([['a'], ['b']]))}`, 5000);
    await sleepMs(300);
    const stillProcessing = !(await finished());
    r.check(`${label}: finished Split keeps the processing state of the running Filter`, splitDone && stillProcessing, `split=${splitDone} processing=${stillProcessing}`);
    await page.waitFor(`__t.snackLog.some((s) => s.startsWith('error'))`, 20000);
    const ended = await page.waitFor(`!!__t.page().querySelector('.mode-toggle')`, 5000);
    snacks = await page.eval('__t.takeSnacks()');
    r.check(
      `${label}: the Filter timeout ends the processing state afterwards`,
      ended && snacks.filter((s) => s.startsWith('error')).length === 1 && expectedError.test(snacks.find((s) => s.startsWith('error'))) && exceptionsSince(n).length === 0,
      JSON.stringify(snacks)
    );
    await page.eval(`__t.nav('filter'); true`);
    await sleepMs(200);
    await setText('apple\nbanana');
  }
  await setInput('');

  // --- Split: Rust-only pattern is validated by the engine that runs it ---
  const regexCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /regex/i.test(e.innerText)).querySelector('input')`;
  await page.eval(`__t.nav('split'); true`);
  await sleepMs(200);
  await setText('aXb');
  await page.eval(`${regexCheckbox}.checked || ${regexCheckbox}.click(); true`);
  await sleepMs(150);
  await setInput('(?i)x');
  n = page.logs.length;
  await page.eval(`__t.watchSnacks(); __t.page().querySelector('button[title="Split text"]').click(); true`);
  if (engine === 'rust') {
    const split = await page.waitFor(`JSON.stringify(__t.columns()) === ${JSON.stringify(JSON.stringify([['a'], ['b']]))}`, 5000);
    const errors = (await page.eval('__t.takeSnacks()')).filter((s) => s.startsWith('error'));
    r.check(`${label}: Split with Rust-only pattern (?i)x is processed by Rust`, split && errors.length === 0, `${JSON.stringify(await page.eval('__t.columns()'))} ${JSON.stringify(errors)}`);
  } else {
    await page.waitFor(`__t.snackLog.length > 0`, 5000);
    await sleepMs(300);
    snacks = await page.eval('__t.takeSnacks()');
    r.check(
      `${label}: Split with (?i)x -> invalid regex with the JS engine message`,
      snacks.length === 1 && /^error: .*(regex|regul).*Invalid regular expression/i.test(snacks[0]) && exceptionsSince(n).length === 0,
      JSON.stringify(snacks)
    );
  }
  await page.eval(`${regexCheckbox}.checked && ${regexCheckbox}.click(); true`);
  await setInput('_');

  // --- Filter pattern preview (runs in the preview worker) ---
  const previewCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /pattern matches/i.test(e.innerText)).querySelector('input')`;
  const note = () => page.eval(`__t.page().querySelector('.match-preview .preview-note')?.innerText ?? null`);
  await page.eval(`__t.nav('filter'); true`);
  await sleepMs(200);
  await page.eval(`${previewCheckbox}.checked || ${previewCheckbox}.click(); true`);
  await setText('an apple');
  n = page.logs.length;
  await setInput('ap');
  const highlighted = await page.waitFor(`__t.page().querySelector('.match-preview .match-highlight')?.innerText === 'ap'`, 5000);
  const hint = await note();
  r.check(
    `${label}: preview highlights the match${engine === 'rust' ? ' and names the JS engine' : ''}`,
    highlighted && (engine === 'rust' ? /JavaScript/.test(hint ?? '') : hint === null),
    JSON.stringify(hint)
  );

  await setInput('(?i)ap');
  const unsupported = engine === 'rust' ? /JavaScript/ : /Invalid regular expression/;
  const noteShown = await page.waitFor(`/${unsupported.source}/.test(__t.page().querySelector('.match-preview .preview-note.error')?.innerText ?? '')`, 5000);
  r.check(
    `${label}: preview of a pattern JS cannot compile -> note, no matches`,
    noteShown && !(await page.eval(`!!__t.page().querySelector('.match-preview .match-highlight')`)),
    JSON.stringify(await note())
  );

  if (engine === 'rust') {
    // The note follows the selected engine without a new preview run (Rust -> JS -> Rust)
    const noteMatches = (re) => page.waitFor(`/${re.source}/.test(__t.page().querySelector('.match-preview .preview-note.error')?.innerText ?? '')`, 5000);
    await page.eval(`__t.page().querySelector('.mode-toggle').click(); true`);
    const jsNote = await noteMatches(/Invalid regular expression/);
    const jsText = await note();
    await page.eval(`__t.page().querySelector('.mode-toggle').click(); true`);
    const rustNote = await noteMatches(/JavaScript/);
    r.check(`${label}: preview note follows an engine switch (JS: engine error, Rust: not supported by JS)`, jsNote && rustNote, `js=${JSON.stringify(jsText)} rust=${JSON.stringify(await note())}`);
  }

  await setText(CATASTROPHIC.text);
  await setInput(CATASTROPHIC.pattern);
  const previewLatency = await maxLatency(1500);
  const stopped = await page.waitFor(`/aufwendig|too complex/i.test(__t.page().querySelector('.match-preview .preview-note.error')?.innerText ?? '')`, 8000);
  r.check(`${label}: preview of a catastrophic regex is stopped, UI responsive`, stopped && previewLatency < 1000, `max ${previewLatency} ms, note=${JSON.stringify(await note())}`);
  r.check(`${label}: preview checks without exceptions`, exceptionsSince(n).length === 0, JSON.stringify(exceptionsSince(n)));

  await page.eval(`${previewCheckbox}.checked && ${previewCheckbox}.click(); true`);
  await setInput('');
  // The source text is shared by the pages: leave a harmless one for the following checks
  await setText('a_b');
}

/**
 * Filter pattern preview (Paket 10 C2) on the real Filter page; the preview always runs the JS RegExp in its worker
 * (`engine` = engine of the Filter itself): a partial match of an emoji is a note, not a highlight; whole emoji are
 * highlighted; switching "split matches" updates the preview; a limited preview is marked and renders a bounded number of
 * highlights; a valid preview works after an error; in Rust mode a note names the JS engine of the preview, and the
 * surrogate notes speak about the JS preview only (the real Rust Filter succeeds where the JS Filter refuses).
 */
export async function checkMatchPreview(page, r, label, errorsSince, engine) {
  const exceptionsSince = (n) => errorsSince(n).filter((l) => l.kind === 'exception');
  const checkbox = (re) => `[...__t.page().querySelectorAll('.input-box')].find(e => ${re}.test(e.innerText)).querySelector('input')`;
  const setChecked = (re, on) => page.eval(`${checkbox(re)}.checked !== ${on} && ${checkbox(re)}.click(); true`);
  const setText = async (value) => {
    await page.eval(`__t.set(__t.textareas()[0], ${value}); true`);
    await sleepMs(150);
  };
  const setPattern = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  const view = () =>
    page.eval(`(() => { const p = __t.page().querySelector('.match-preview'); return p && {
      notes: [...p.querySelectorAll('.preview-note')].map(n => n.className.replace('preview-note', '').trim() + ': ' + n.innerText),
      highlights: [...p.querySelectorAll('.match-highlight')].map(h => h.innerText),
      spans: p.querySelector('.preview-content')?.querySelectorAll('span').length ?? 0,
      elisions: [...p.querySelectorAll('.preview-elision')].map(e => e.innerText),
      count: p.querySelector('.match-count')?.innerText ?? null } })()`);
  const waitView = async (condition) => {
    await page.waitFor(`(() => { const p = __t.page().querySelector('.match-preview'); return !!p && (${condition}); })()`, 8000);
    return view();
  };
  const PREVIEW = /pattern matches/i;
  const SPLIT = /separate/i;
  const CUT = /Teil eines Zeichens|part of a character/i;
  const JS_ENGINE = /JavaScript-RegExp|JavaScript RegExp/;
  // Statements about the JS Filter (JS mode only) and the qualification of the Rust mode notes
  const JS_REFUSES = /würde diesen Text ablehnen|would refuse this text/;
  const KEEP_REFUSED = /wird abgelehnt|is refused/;
  const OWN_ENGINE = /eigenen Engine|its own engine/;
  const REMOVE = 0;
  const KEEP = 1;
  /** Runs the real Filter (`.filter-actions` button) on an empty result: the result and the snackbars it shows */
  const result = `(__t.textareas()[1] ? __t.raw(__t.textareas()[1]) : '')`;
  const runFilter = async (button) => {
    // The result field exists only after a first result
    await page.eval(`__t.textareas()[1] && __t.set(__t.textareas()[1], ''); __t.watchSnacks(); true`);
    await sleepMs(100);
    await page.eval(`__t.page().querySelectorAll('.filter-actions button')[${button}].click(); true`);
    await page.waitFor(`__t.snackLog.length > 0 || ${result} !== ''`, 8000);
    await sleepMs(300);
    return { result: await page.eval(result), snacks: await page.eval('__t.takeSnacks()') };
  };

  const n = page.logs.length;
  await page.eval(`__t.nav('filter'); true`);
  await sleepMs(200);
  await setChecked(SPLIT, false);
  await setChecked(PREVIEW, true);
  await setText(`'a😀b\\nc😁d'`);

  // 1. A pattern that matches only one half of the emoji: note instead of a misleading highlight
  await setPattern('\\uD83D');
  let v = await waitView(`p.querySelector('.preview-note.error')`);
  r.check(`${label}: preview of a surrogate half -> note, no highlight`, v.highlights.length === 0 && v.notes.some((note) => note.startsWith('error') && CUT.test(note)), JSON.stringify(v));
  r.check(`${label}: preview engine note ${engine === 'rust' ? 'names JavaScript in Rust mode' : 'only in Rust mode'}`, v.notes.some((note) => JS_ENGINE.test(note)) === (engine === 'rust'), JSON.stringify(v.notes));

  // 2. A whole emoji is highlighted; the counter names lines and matches
  await setPattern('😀');
  v = await waitView(`p.querySelector('.match-highlight')?.innerText === '😀'`);
  r.check(`${label}: preview highlights a whole emoji`, JSON.stringify(v.highlights) === '["😀"]' && /1 (Treffer|matches) in 1/.test(v.count ?? ''), JSON.stringify(v));

  // 3. "split matches" changes the preview: halves joined into one highlight are reported only with it
  await setText(`'😀x'`);
  await setPattern('.');
  // Two highlights: the joined emoji and x (the previous preview showed one)
  v = await waitView(`p.querySelectorAll('.match-highlight').length === 2 && !p.querySelector('.preview-note.warning')`);
  r.check(`${label}: preview joins adjacent halves into one highlight`, v.highlights[0] === '😀' && v.highlights.length === 2, JSON.stringify(v));
  await setChecked(SPLIT, true);
  v = await waitView(`!!p.querySelector('.preview-note.warning')`);
  r.check(`${label}: switching "split matches" on updates the preview (keep would cut the emoji)`, v.highlights[0] === '😀' && v.notes.some((note) => note.startsWith('warning')), JSON.stringify(v.notes));
  const warning = v.notes.find((note) => note.startsWith('warning')) ?? '';
  r.check(
    `${label}: joined-halves note ${engine === 'rust' ? 'names the JS preview, promises no refusal by the Rust Filter' : 'names the refusal of keep with split matches'}`,
    engine === 'rust' ? !KEEP_REFUSED.test(warning) && OWN_ENGINE.test(warning) : KEEP_REFUSED.test(warning),
    warning
  );
  // The real Filter, keep with split matches: JS refuses the cut emoji, Rust (fancy-regex) matches whole characters
  let outcome = await runFilter(KEEP);
  r.check(
    `${label}: Filter keep with split matches on '😀x' with '.' ${engine === 'rust' ? 'succeeds in Rust (😀 / x)' : 'is refused by the JS Filter'}`,
    engine === 'rust' ? outcome.result === '😀\nx' && !outcome.snacks.some((s) => s.startsWith('error')) : outcome.result === '' && outcome.snacks.some((s) => s.startsWith('error') && CUT.test(s)),
    JSON.stringify(outcome)
  );
  await setChecked(SPLIT, false);
  v = await waitView(`!p.querySelector('.preview-note.warning')`);
  r.check(`${label}: switching "split matches" off removes the note`, !v.notes.some((note) => note.startsWith('warning')), JSON.stringify(v.notes));

  // 3b. [😀] on 😁: JS RegExp matches the shared high half (preview note); Rust treats the class as Unicode, no match
  await setText(`'😁'`);
  await setPattern('[😀]');
  v = await waitView(`!!p.querySelector('.preview-note.error')`);
  const cutNote = v.notes.find((note) => note.startsWith('error')) ?? '';
  r.check(
    `${label}: preview of [😀] on 😁 ${engine === 'rust' ? 'is limited to the JS preview, promises no refusal by the Rust Filter' : 'names the refusal of the JS Filter'}`,
    v.highlights.length === 0 && CUT.test(cutNote) && (engine === 'rust' ? !JS_REFUSES.test(cutNote) && OWN_ENGINE.test(cutNote) : JS_REFUSES.test(cutNote)),
    cutNote
  );
  outcome = await runFilter(REMOVE);
  r.check(
    `${label}: Filter remove of [😀] on 😁 ${engine === 'rust' ? 'succeeds in Rust (text unchanged)' : 'is refused by the JS Filter'}`,
    engine === 'rust' ? outcome.result === '😁' && !outcome.snacks.some((s) => s.startsWith('error')) : outcome.result === '' && outcome.snacks.some((s) => s.startsWith('error') && CUT.test(s)),
    JSON.stringify(outcome)
  );

  // 4. Many matches: limited, marked, a bounded number of spans (no fixed timing)
  await setText(`'ab'.repeat(100000)`);
  await setPattern('a');
  v = await waitView(`!!p.querySelector('.preview-note.incomplete')`);
  r.check(
    `${label}: preview of 100,000 matches is limited and marked as incomplete`,
    v.highlights.length === 1000 && v.spans <= 2002 && v.elisions.length === 1 && /mindestens|at least/i.test(v.count ?? ''),
    JSON.stringify({ highlights: v.highlights.length, spans: v.spans, elisions: v.elisions, count: v.count, notes: v.notes })
  );

  // 5. After a preview error a valid preview works
  await setText(`'apple'`);
  await setPattern('(');
  v = await waitView(`!!p.querySelector('.preview-note.error')`);
  await setPattern('pl');
  v = await waitView(`p.querySelector('.match-highlight')?.innerText === 'pl'`);
  r.check(`${label}: valid preview after an error`, JSON.stringify(v.highlights) === '["pl"]' && !v.notes.some((note) => note.startsWith('error')), JSON.stringify(v));
  r.check(`${label}: preview checks without exceptions`, exceptionsSince(n).length === 0, JSON.stringify(exceptionsSince(n)));

  await setChecked(PREVIEW, false);
  await setPattern('');
  // The source text is shared by the pages: leave a harmless one
  await setText(`'a_b'`);
}

/**
 * Regex pattern rule (Paket 10 C3, E3) on the real Split, Filter and Remove pages in the current engine (`engine`):
 * an empty regex pattern and one of more than 10,000 UTF-16 code units (also 5,001 emoji) are refused with their own
 * message, never as a syntax error; the previous result and metrics stay and a later valid job works. Split checks the
 * rule on the page (and the engines), Filter and Remove report a too long pattern from the engine. Plain delimiters and
 * plain search terms are not limited, duplicates ignore the pattern. The pattern preview names the length, also in Rust
 * mode (not "JavaScript does not support this pattern").
 */
export async function checkPatternRule(page, r, label, errorsSince, engine) {
  const exceptionsSince = (n) => errorsSince(n).filter((l) => l.kind === 'exception');
  const checkbox = (re) => `[...__t.page().querySelectorAll('.input-box')].find(e => ${re}.test(e.innerText)).querySelector('input')`;
  const setChecked = async (re, on) => {
    await page.eval(`${checkbox(re)}.checked !== ${on} && ${checkbox(re)}.click(); true`);
    await sleepMs(100);
  };
  /** `value` is a JS expression evaluated in the page (long texts are not sent over CDP) */
  const setText = async (value) => {
    await page.eval(`__t.set(__t.textareas()[0], ${value}); true`);
    await sleepMs(150);
  };
  const setPattern = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${value}); true`);
    await sleepMs(150);
  };
  /** Clicks, waits for the first snackbar and returns all snackbars shown meanwhile */
  const run = async (clickExpr) => {
    await page.eval(`__t.watchSnacks(); ${clickExpr}; true`);
    await page.waitFor(`__t.snackLog.length > 0`, 10000);
    await sleepMs(300);
    return page.eval('__t.takeSnacks()');
  };
  const metrics = () => page.eval(`__t.page().querySelector('.metrics-group')?.innerText ?? null`);
  const resultText = () => page.eval(`__t.textareas()[1] ? __t.raw(__t.textareas()[1]) : null`);
  const EMPTY = /Regex-Muster darf nicht leer|regex pattern must not be empty/;
  const TOO_LONG = /Regex-Muster ist zu lang|regex pattern is too long/;
  const SYNTAX = /Ungültige Syntax|Invalid regular expression syntax/;
  const NOT_JS = /JavaScript unterstützt dieses Muster nicht|JavaScript does not support/;
  const oneError = (snacks, reason) => snacks.length === 1 && snacks[0].startsWith('error') && reason.test(snacks[0]) && !SYNTAX.test(snacks[0]);
  const LONG = `'a'.repeat(10001)`;
  const EMOJI = `'😀'.repeat(5001)`;
  const REGEX = /regex/i;

  /** The refused patterns of one page: one error with the reason, result and metrics unchanged */
  const refuses = async (page_, click, read, cases) => {
    for (const [pattern, reason, what] of cases) {
      const before = { result: await read(), metrics: await metrics() };
      await setPattern(pattern);
      const n = page.logs.length;
      const snacks = await run(click);
      const after = { result: await read(), metrics: await metrics() };
      r.check(
        `${label}: ${page_} ${what} -> own error message, previous result and metrics kept`,
        oneError(snacks, reason) && JSON.stringify(after) === JSON.stringify(before) && exceptionsSince(n).length === 0,
        `${JSON.stringify(snacks)} ${JSON.stringify(after) === JSON.stringify(before) ? '' : JSON.stringify({ before, after })}`
      );
    }
  };
  const PATTERNS = [
    [`''`, EMPTY, 'empty regex pattern'],
    [LONG, TOO_LONG, 'regex pattern of 10,001 UTF-16 code units'],
    [EMOJI, TOO_LONG, 'regex pattern of 5,001 emoji (10,002 UTF-16 code units)'],
  ];

  // --- Split ---
  const split = `__t.page().querySelector('button[title="Split text"]').click()`;
  const columns = () => page.eval('JSON.stringify(__t.columns())');
  await page.eval(`__t.nav('split'); true`);
  await sleepMs(250);
  await setText(`'a,b\\nc'`);
  await setChecked(REGEX, true);
  await setPattern(`','`);
  let snacks = await run(split);
  r.check(`${label}: Split regex valid result before the pattern errors`, (await columns()) === JSON.stringify([['a', 'c'], ['b', '']]), `${await columns()} ${JSON.stringify(snacks)}`);
  await refuses('Split', split, columns, PATTERNS);
  await setText(`'x y'`);
  await setPattern(`' '`);
  snacks = await run(split);
  r.check(`${label}: Split regex works after the pattern errors (whitespace pattern)`, (await columns()) === JSON.stringify([['x'], ['y']]) && snacks.every((s) => !s.startsWith('error')), `${await columns()} ${JSON.stringify(snacks)}`);
  // A plain delimiter is not limited; an empty one is still emptyDelimiter (C1)
  await setChecked(REGEX, false);
  await setText(`'x' + ${LONG} + 'y'`);
  await setPattern(LONG);
  snacks = await run(split);
  r.check(`${label}: Split plain delimiter of 10,001 characters is allowed`, (await columns()) === JSON.stringify([['x'], ['y']]) && snacks.every((s) => !s.startsWith('error')), `${(await columns()).slice(0, 80)} ${JSON.stringify(snacks)}`);
  await setPattern(`''`);
  snacks = await run(split);
  r.check(`${label}: Split empty plain delimiter -> emptyDelimiter, not the regex message`, snacks.length === 1 && /Trennzeichen darf nicht leer|delimiter must not be empty/.test(snacks[0]) && !EMPTY.test(snacks[0]), JSON.stringify(snacks));
  await setPattern(`'_'`);
  await setText(`'a_b'`);

  // --- Filter ---
  const keep = `__t.page().querySelectorAll('.filter-actions button')[1].click()`;
  await page.eval(`__t.nav('filter'); true`);
  await sleepMs(250);
  await setChecked(/pattern matches/i, false);
  await setText(`'apple\\nbanana'`);
  await setPattern(`'ban'`);
  snacks = await run(keep);
  r.check(`${label}: Filter valid result before the pattern errors`, (await resultText()) === 'ban', `${JSON.stringify(await resultText())} ${JSON.stringify(snacks)}`);
  await refuses('Filter', keep, resultText, PATTERNS);
  await setPattern(`'app'`);
  snacks = await run(keep);
  r.check(`${label}: Filter works after the pattern errors`, (await resultText()) === 'app' && snacks.every((s) => s.startsWith('success')), `${JSON.stringify(await resultText())} ${JSON.stringify(snacks)}`);

  // Pattern preview: the length is the reason, also in Rust mode
  await setChecked(/pattern matches/i, true);
  await setPattern(LONG);
  await page.waitFor(`!!__t.page().querySelector('.match-preview .preview-note.error')`, 8000);
  const notes = await page.eval(`[...__t.page().querySelectorAll('.match-preview .preview-note')].map((n) => n.className + ': ' + n.innerText)`);
  const errorNote = notes.find((note) => note.includes('error')) ?? '';
  r.check(
    `${label}: preview of a too long pattern names the length${engine === 'rust' ? ', not a JS syntax incompatibility' : ''}`,
    TOO_LONG.test(errorNote) && !NOT_JS.test(errorNote) && !SYNTAX.test(errorNote) && !(await page.eval(`!!__t.page().querySelector('.match-preview .match-highlight')`)),
    JSON.stringify(notes)
  );
  r.check(`${label}: preview engine note ${engine === 'rust' ? 'stays in Rust mode' : 'only in Rust mode'}`, notes.some((note) => /JavaScript-RegExp|JavaScript RegExp/.test(note) && !note.includes('error')) === (engine === 'rust'), JSON.stringify(notes));
  await setPattern(`'an'`);
  await page.waitFor(`__t.page().querySelector('.match-preview .match-highlight')?.innerText === 'an'`, 8000);
  r.check(`${label}: valid preview after the length error`, true);
  await setChecked(/pattern matches/i, false);
  await setPattern(`''`);

  // --- Remove ---
  const containing = `__t.page().querySelector('.remove-action-button.containing').click()`;
  const duplicates = `__t.page().querySelector('.remove-action-button.duplicates').click()`;
  await page.eval(`__t.nav('remove'); true`);
  await sleepMs(250);
  await setText(`'a1\\nb'`);
  await setChecked(REGEX, true);
  await setPattern(`'\\\\d'`);
  snacks = await run(containing);
  r.check(`${label}: Remove regex valid result before the pattern errors`, (await resultText()) === 'b', `${JSON.stringify(await resultText())} ${JSON.stringify(snacks)}`);
  await refuses('Remove', containing, resultText, PATTERNS);
  await setPattern(`'^b'`);
  snacks = await run(containing);
  r.check(`${label}: Remove regex works after the pattern errors`, (await resultText()) === 'a1' && snacks.every((s) => s.startsWith('success')), `${JSON.stringify(await resultText())} ${JSON.stringify(snacks)}`);
  // Duplicates ignore the pattern (empty, invalid or too long)
  await setText(`'x\\nx\\ny'`);
  for (const pattern of [`''`, `'([a-'`, LONG]) {
    await setPattern(pattern);
    snacks = await run(duplicates);
    r.check(`${label}: Remove duplicates ignores the regex pattern ${pattern.slice(0, 12)}`, (await resultText()) === 'x\ny' && snacks.length === 1 && snacks[0].startsWith('success'), `${JSON.stringify(await resultText())} ${JSON.stringify(snacks)}`);
  }
  // A plain search term is not limited
  await setChecked(REGEX, false);
  await setText(`'keep\\n' + ${LONG}`);
  await setPattern(LONG);
  snacks = await run(containing);
  r.check(`${label}: Remove plain search term of 10,001 characters is allowed`, (await resultText()) === 'keep' && snacks.length === 1 && snacks[0].startsWith('success'), `${JSON.stringify(await resultText())} ${JSON.stringify(snacks)}`);
  await setPattern(`''`);
  // The source text is shared by the pages: leave a harmless one
  await setText(`'a_b'`);
}

/**
 * Split regex flags (Paket 10 C4, E9) on the real Split page in the current engine (`engine`): the JS split uses the flag g
 * only, so ^ and $ do not match next to U+2028/U+2029 inside a line (the former flag m did); Rust is unchanged. Safe emoji
 * splits keep working and a valid split works after a regex error.
 */
export async function checkSplitFlags(page, r, label, errorsSince, engine) {
  const exceptionsSince = (n) => errorsSince(n).filter((l) => l.kind === 'exception');
  const regexCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /regex/i.test(e.innerText)).querySelector('input')`;
  const setText = async (value) => {
    await page.eval(`__t.set(__t.textareas()[0], ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  const setSeparator = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  const columns = () => page.eval('JSON.stringify(__t.columns())');
  /** Splits and waits for the first snackbar (all snackbars shown meanwhile) */
  const split = async () => {
    await page.eval(`__t.watchSnacks(); __t.page().querySelector('button[title="Split text"]').click(); true`);
    await page.waitFor(`__t.snackLog.length > 0`, 8000);
    await sleepMs(300);
    return page.eval('__t.takeSnacks()');
  };
  const js = engine === 'js';
  const n = page.logs.length;
  await page.eval(`__t.nav('split'); true`);
  await sleepMs(250);
  await page.eval(`${regexCheckbox}.checked || ${regexCheckbox}.click(); true`);
  await sleepMs(100);

  // [text, pattern, JS result (flag g), Rust result, former JS result with gm]
  const cases = [
    ['a b', '$', [['a b']], [['a b'], ['']], [['a'], [' b']]],
    ['a b', 'a$', [['a b']], [['a b']], [[''], [' b']]],
    ['a b', '^b', [['a b']], [['a b']], [['a '], ['']]],
    // Safe emoji splits next to U+2028 (Rust split inserts no captures)
    ['a😀 😀b', '(😀)', [['a'], ['😀'], [' '], ['😀'], ['b']], [['a'], [' '], ['b']], null],
    ['a😀 😀b', '(😀)$', [['a😀 😀b']], [['a😀 😀b']], [['a'], ['😀'], [' 😀b']]],
  ];
  for (const [text, pattern, jsResult, rustResult, formerJs] of cases) {
    await setText(text);
    await setSeparator(pattern);
    const snacks = await split();
    const expected = JSON.stringify(js ? jsResult : rustResult);
    r.check(
      `${label}: Split ${JSON.stringify(pattern)} on ${JSON.stringify(text)} -> ${js ? 'flag g' : 'Rust'} result${formerJs && js ? ' (not the former gm result)' : ''}`,
      (await columns()) === expected && snacks.every((s) => !s.startsWith('error')),
      `${await columns()} ${JSON.stringify(snacks)} expected ${expected}${formerJs ? `, former gm ${JSON.stringify(formerJs)}` : ''}`
    );
  }

  // A controlled regex error keeps the columns; a valid split works afterwards
  const before = await columns();
  await setSeparator('(');
  let snacks = await split();
  r.check(`${label}: Split regex error after the E9 cases -> one error, columns kept`, snacks.length === 1 && snacks[0].startsWith('error') && (await columns()) === before, `${JSON.stringify(snacks)} ${await columns()}`);
  await setText('ab\nba');
  await setSeparator('^a|a$');
  snacks = await split();
  r.check(`${label}: Split ^a|a$ at the real start and end of the data lines works after the error`, (await columns()) === JSON.stringify([['', 'b'], ['b', '']]) && snacks.every((s) => !s.startsWith('error')), `${await columns()} ${JSON.stringify(snacks)}`);
  r.check(`${label}: Split flag checks without exceptions`, exceptionsSince(n).length === 0, JSON.stringify(exceptionsSince(n)));

  await page.eval(`${regexCheckbox}.checked && ${regexCheckbox}.click(); true`);
  await setSeparator('_');
  await setText('a_b');
}

/**
 * Split data integrity (Paket 10 C1) on the real Split page in the current engine (`engine`: 'js' worker or 'rust'):
 * an empty plain delimiter is refused (E4), a regex split that would cut an emoji is refused in JS (E5; Rust never cuts a
 * character and rejects surrogate escapes), no damaged or partial result is applied, the previous result and metrics stay,
 * and safe emoji delimiters and a later valid split work.
 */
export async function checkSplitIntegrity(page, r, label, errorsSince, engine) {
  const exceptionsSince = (n) => errorsSince(n).filter((l) => l.kind === 'exception');
  const regexCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /regex/i.test(e.innerText)).querySelector('input')`;
  const setRegex = (on) => page.eval(`${regexCheckbox}.checked !== ${on} && ${regexCheckbox}.click(); true`);
  const setText = async (value) => {
    await page.eval(`__t.set(__t.textareas()[0], ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  const setSeparator = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  const state = () => page.eval(`({ columns: __t.columns(), metrics: __t.page().querySelector('.metrics-group')?.innerText ?? null })`);
  const split = `__t.page().querySelector('button[title="Split text"]').click()`;
  /** Splits and waits for the first snackbar (all snackbars shown meanwhile) */
  const splitForSnacks = async () => {
    await page.eval(`__t.watchSnacks(); ${split}; true`);
    await page.waitFor(`__t.snackLog.length > 0`, 8000);
    await sleepMs(300);
    return page.eval('__t.takeSnacks()');
  };
  /** Splits and waits until the columns equal `expected`; returns the error snackbars */
  const splitForColumns = async (expected) => {
    await page.eval(`__t.watchSnacks(); ${split}; true`);
    const ok = await page.waitFor(`JSON.stringify(__t.columns()) === ${JSON.stringify(JSON.stringify(expected))}`, 8000);
    await sleepMs(200);
    return { ok, errors: (await page.eval('__t.takeSnacks()')).filter((s) => s.startsWith('error')) };
  };
  const EMPTY_DELIMITER = /Trennzeichen darf nicht leer|delimiter must not be empty/i;
  const CUT_CHARACTER = /Teil eines Zeichens|part of a character/i;

  await page.eval(`__t.nav('split'); true`);
  await sleepMs(200);
  await setRegex(false);
  let n = page.logs.length;
  await setText('a😀b,c\nd🎉e,f');
  await setSeparator(',');
  let outcome = await splitForColumns([['a😀b', 'd🎉e'], ['c', 'f']]);
  r.check(`${label}: Split with emoji in the values`, outcome.ok && outcome.errors.length === 0, JSON.stringify(await state()));
  const before = await state();

  // E4: empty plain delimiter
  await setSeparator('');
  let snacks = await splitForSnacks();
  r.check(`${label}: Split with an empty plain delimiter -> one input error`, snacks.length === 1 && snacks[0].startsWith('error') && EMPTY_DELIMITER.test(snacks[0]), JSON.stringify(snacks));
  r.check(`${label}: empty delimiter -> previous result and metrics kept`, JSON.stringify(await state()) === JSON.stringify(before), JSON.stringify(await state()));

  // E5: a regex that matches the halves of the emoji separately ([😀] without u flag) and a capture of one half
  await setRegex(true);
  await setText('a😀b');
  await setSeparator('[😀]');
  if (engine === 'js') {
    snacks = await splitForSnacks();
    r.check(`${label}: regex [😀] would cut the emoji -> one input error`, snacks.length === 1 && snacks[0].startsWith('error') && CUT_CHARACTER.test(snacks[0]), JSON.stringify(snacks));
    r.check(`${label}: cut character -> no damaged or partial result, metrics kept`, JSON.stringify(await state()) === JSON.stringify(before), JSON.stringify(await state()));
    await setSeparator('(\\uD83D)\\uDE00');
    snacks = await splitForSnacks();
    r.check(`${label}: capture of one surrogate half -> one input error`, snacks.length === 1 && CUT_CHARACTER.test(snacks[0]), JSON.stringify(snacks));
    r.check(`${label}: capture of one surrogate half -> previous result kept`, JSON.stringify(await state()) === JSON.stringify(before), JSON.stringify(await state()));
  } else {
    // Rust matches Unicode scalar values: the class holds the emoji, nothing is cut
    outcome = await splitForColumns([['a'], ['b']]);
    r.check(`${label}: regex [😀] splits at the whole emoji (Rust)`, outcome.ok && outcome.errors.length === 0, JSON.stringify(await state()));
    await setSeparator('(\\uD83D)\\uDE00');
    snacks = await splitForSnacks();
    r.check(`${label}: surrogate escape is an invalid regex in Rust`, snacks.length === 1 && /^error: .*(regex|regul)/i.test(snacks[0]), JSON.stringify(snacks));
  }

  // Safe emoji splits after the errors
  await setSeparator('(😀)');
  outcome = await splitForColumns(engine === 'js' ? [['a'], ['😀'], ['b']] : [['a'], ['b']]);
  r.check(`${label}: regex with a whole-emoji capture works after an error`, outcome.ok && outcome.errors.length === 0, JSON.stringify(await state()));
  await setRegex(false);
  await setText('x😀y\nz');
  await setSeparator('😀');
  outcome = await splitForColumns([['x', 'z'], ['y', '']]);
  r.check(`${label}: plain emoji delimiter works`, outcome.ok && outcome.errors.length === 0, JSON.stringify(await state()));
  r.check(`${label}: split integrity checks without exceptions`, exceptionsSince(n).length === 0, JSON.stringify(exceptionsSince(n)));

  // The source text is shared by the pages: leave a harmless one and the usual separator
  await setText('a_b');
  await setSeparator('_');
}

/**
 * Combine state (Paket 6 follow-up) in the current processing mode (Rust: `combine_columns`, JS: frontend): adding a
 * column is a new state even if the combined text is '' or unchanged; undo/redo restore the used columns.
 */
export async function checkCombineState(page, r, label, errorsSince) {
  const n = page.logs.length;
  const json = (value) => JSON.stringify(value);
  const combined = () => page.eval(`__t.raw(__t.page().querySelector('.combine-textarea'))`);
  /** Number of used column buttons (the column selector is opened and closed again) */
  const usedCount = async () => {
    await page.eval(`document.querySelector('.combine-icon-link').click(); true`);
    await sleepMs(300);
    const used = await page.eval(`document.querySelectorAll('.column-button-used').length`);
    await page.eval(`document.querySelector('.close-combine-btn')?.click(); true`);
    await sleepMs(200);
    return used;
  };
  const undoRedo = async (i) => {
    await page.eval(`__t.page().querySelectorAll('.combine-action')[${i}].click(); true`);
    await sleepMs(200);
    return { text: await combined(), used: await usedCount() };
  };

  // First column with a single empty value: the valid result is '' and the column counts as used
  let cols = await splitAndRead(page, ',a', ',', [[''], ['a']]);
  await page.eval(`__t.set(__t.page().querySelector('.combine-input'), ''); true`);
  await sleepMs(150);
  let result = await combineColumns(page, [0]);
  r.check(`${label}: Combine of an empty first column -> '' and the column is used`, result.used === 1 && (await combined()) === '', `${json(cols)} ${json(result)}`);

  // An all-empty column with empty separator: same text, but two used columns; undo/redo follow the used columns
  cols = await splitAndRead(page, 'a,\nb,', ',', [['a', 'b'], ['', '']]);
  result = await combineColumns(page, [0, 1]);
  r.check(`${label}: Combine of an all-empty column -> unchanged text, column used`, result.used === 2 && (await combined()) === 'a\nb', `${json(cols)} ${json(result)}`);
  const undone = await undoRedo(0);
  r.check(`${label}: Undo after the unchanged-text Combine -> 1 used column`, undone.used === 1 && undone.text === 'a\nb', json(undone));
  const redone = await undoRedo(1);
  r.check(`${label}: Redo -> 2 used columns`, redone.used === 2 && redone.text === 'a\nb', json(redone));
  r.check(`${label}: Combine state checks without errors`, errorsSince(n).length === 0, json(errorsSince(n)));

  await page.eval(`__t.page().querySelector('.combine-clear')?.click(); __t.set(__t.page().querySelector('.combine-input'), ':'); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.textareas()[0], 'a_b'); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), '_'); true`);
  await sleepMs(150);
}

/**
 * Word diff (Paket 7 B3) in the current processing mode (Rust backend or JS worker): off by default, switched on it
 * highlights the words of the changed line pairs only (never the new introduction line), in the unified and the split
 * view (pairs on one row); switching it during a running comparison shows the current mode; copy text and statistics.
 */
export async function checkWordDiff(page, r, label, errorsSince) {
  const n = page.logs.length;
  const json = (value) => JSON.stringify(value);
  const checkbox = `__t.page().querySelector('.word-diff-option input')`;
  const words = (kind, scope = '.diff-result-container') => `[...__t.page().querySelectorAll('${scope} .word-diff.diff-${kind}')].map((w) => w.textContent)`;
  const viewButton = (index) => `__t.page().querySelectorAll('.view-type-options .view-option')[${index}]`;
  await page.eval(`__t.nav('diff'); true`);
  await sleepMs(200);
  await page.eval(`${viewButton(0)}.click(); if (${checkbox}.checked) ${checkbox}.click(); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.textareas()[0], ${json('Titel\nDie schnelle braune Katze springt.\nHallo, Welt!\nEnde')}); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.textareas()[1], ${json('Neue Einleitung\nTitel\nDie schnelle schwarze Katze läuft.\nHallo Welt!\nEnde')}); true`);
  await sleepMs(150);

  // Off (default): line diff only
  await page.eval(`__t.watchSnacks(); __t.page().querySelector('.diff-button').click(); true`);
  await page.waitFor(`__t.snackLog.length > 0`, 8000);
  const offDone = await page.waitFor(`__t.page().querySelectorAll('.unified-diff-view .diff-line').length === 7`, 3000);
  const offWords = await page.eval(`__t.page().querySelectorAll('.word-diff').length`);
  const offStats = await page.eval(`JSON.stringify({ ...__t.page().querySelector('.diff-stats').dataset })`);
  r.check(
    `${label}: word diff off by default -> plain removed/added lines`,
    offDone && offWords === 0 && (await page.eval(`${checkbox}.checked`)) === false && offStats === json({ unchanged: '2', added: '3', removed: '2', moved: '0', changed: '0', wordDiff: 'false' }),
    `words=${offWords} stats=${offStats}`,
  );

  // On: computed for the same comparison, only the paired lines are highlighted
  await page.eval(`${checkbox}.click(); true`);
  const onDone = await page.waitFor(`${words('removed')}.length > 0`, 8000);
  const removedWords = await page.eval(words('removed'));
  const addedWords = await page.eval(words('added'));
  const intro = await page.eval(`[...__t.page().querySelectorAll('.unified-diff-view .diff-line')].find((l) => l.textContent.includes('Neue Einleitung')).querySelectorAll('.word-diff').length`);
  const onStats = await page.eval(`JSON.stringify({ changed: __t.page().querySelector('.diff-stats').dataset.changed, wordDiff: __t.page().querySelector('.diff-stats').dataset.wordDiff })`);
  r.check(
    `${label}: word diff on -> removed/added words of the paired lines, introduction line not compared`,
    onDone && json(removedWords) === json(['braune', 'springt', ',']) && json(addedWords) === json(['schwarze', 'läuft']) && intro === 0 && onStats === json({ changed: '2', wordDiff: 'true' }),
    `removed=${json(removedWords)} added=${json(addedWords)} intro=${intro} stats=${onStats}`,
  );

  // Split view: the pair shares one row, old words left, new words right
  await page.eval(`${viewButton(1)}.click(); true`);
  await page.waitFor(`!!__t.page().querySelector('.split-diff-view')`, 3000);
  const rowOf = (side, line) => `[...__t.page().querySelectorAll('.split-diff-${side} .split-diff-content > .diff-line')].findIndex((l) => l.dataset.line === '${line}')`;
  const rows = await page.eval(`[${rowOf('original', 2)}, ${rowOf('new', 3)}, ${rowOf('original', 3)}, ${rowOf('new', 4)}, ${rowOf('new', 1)}]`);
  const leftAdded = await page.eval(words('added', '.split-diff-original'));
  const rightRemoved = await page.eval(words('removed', '.split-diff-new'));
  const splitRemoved = await page.eval(words('removed', '.split-diff-original'));
  r.check(
    `${label}: split view -> pairs on one row, removed words left, added words right`,
    rows[0] === rows[1] && rows[2] === rows[3] && rows[0] >= 0 && rows[2] >= 0 && rows[4] >= 0 && leftAdded.length === 0 && rightRemoved.length === 0 && json(splitRemoved) === json(['braune', 'springt', ',']),
    `rows=${json(rows)} leftAdded=${json(leftAdded)} rightRemoved=${json(rightRemoved)} removed=${json(splitRemoved)}`,
  );
  await page.eval(`${viewButton(0)}.click(); true`);
  await sleepMs(150);

  // Copy: readable unified text
  await page.eval(`__t.captureCopy(); __t.page().querySelector('.title-actions .copy-button').click(); true`);
  await page.waitFor(`__t.copied !== null`, 3000);
  const copied = await page.eval('__t.copied');
  await page.eval('__t.releaseCopy(); true');
  r.check(
    `${label}: copied diff is readable text`,
    copied === '+ Neue Einleitung\n  Titel\n- Die schnelle braune Katze springt.\n- Hallo, Welt!\n+ Die schnelle schwarze Katze läuft.\n+ Hallo Welt!\n  Ende',
    json(copied),
  );

  // Off again: hidden at once, no recomputation
  await page.eval(`__t.watchSnacks(); ${checkbox}.click(); true`);
  await sleepMs(300);
  const hidden = await page.eval(`__t.page().querySelectorAll('.word-diff').length`);
  r.check(`${label}: switching the word diff off hides it without a new comparison`, hidden === 0 && __noSnacks(await page.eval('__t.takeSnacks()')), `words=${hidden}`);

  // Switched on while the comparison (without word diff) is still running: the shown result has the word diff
  await page.eval(`__t.watchSnacks(); __t.page().querySelector('.diff-button').click(); ${checkbox}.click(); true`);
  const raceDone = await page.waitFor(`${words('removed')}.length === 3`, 8000);
  await sleepMs(500);
  const raceSnacks = await page.eval('__t.takeSnacks()');
  r.check(
    `${label}: word diff switched on during a running comparison -> current mode shown, no error`,
    raceDone && (await page.eval(`${checkbox}.checked`)) === true && raceSnacks.every((s) => !s.startsWith('error')),
    `snacks=${json(raceSnacks)}`,
  );

  // Leave the defaults for the following checks
  await page.eval(`if (${checkbox}.checked) ${checkbox}.click(); true`);
  await sleepMs(150);
  r.check(`${label}: word diff checks without errors`, errorsSince(n).length === 0, json(errorsSince(n)));
}

const __noSnacks = (snacks) => snacks.length === 0;

/**
 * Diff page details (Paket 7 B3), measured in the rendered page: rows are left-aligned behind number and marker in both
 * views (whitespace and tabs kept, word segments complete), the colors and the strike-through of the word diff are
 * unchanged, the whitespace option is labelled "ignore", the statistics name the changed line pairs only with word
 * diff, moves are shown on both sides of the split view, and after a valid comparison that failed (too complex) the word
 * diff is computed for the shown comparison without repeating the failed one.
 */
export async function checkDiffDetails(page, r, label, errorsSince) {
  const n = page.logs.length;
  const json = (value) => JSON.stringify(value);
  const checkbox = `__t.page().querySelector('.word-diff-option input')`;
  const finished = `!!__t.page().querySelector('.mode-toggle')`; // only rendered when not processing
  const viewButton = (index) => `__t.page().querySelectorAll('.view-type-options .view-option')[${index}]`;
  const compare = async (oldText, newText) => {
    await page.eval(`__t.set(__t.textareas()[0], ${json(oldText)}); true`);
    await sleepMs(150);
    await page.eval(`__t.set(__t.textareas()[1], ${json(newText)}); true`);
    await sleepMs(150);
    await page.eval(`__t.watchSnacks(); __t.page().querySelector('.diff-button').click(); true`);
    await page.waitFor(`__t.snackLog.length > 0`, 8000);
    await page.waitFor(finished, 8000);
    return page.eval('__t.takeSnacks()');
  };
  /** Per rendered row of `scope`: left edge of the content box, left edge of its first text, its text */
  const layout = (scope) => `[...__t.page().querySelectorAll('${scope} .diff-line')].filter((l) => !l.classList.contains('empty-slot')).map((l) => {
    const content = l.querySelector('.diff-line-content');
    const range = document.createRange();
    range.selectNodeContents(content);
    return { box: Math.round(content.getBoundingClientRect().left), text: Math.round(range.getClientRects()[0].left), value: content.textContent };
  })`;
  const leftAligned = (rows) => rows.length > 0 && rows.every((row) => row.box === rows[0].box && Math.abs(row.text - row.box) <= 1);

  await page.eval(`__t.nav('diff'); true`);
  await sleepMs(200);
  await page.eval(`${viewButton(0)}.click(); if (${checkbox}.checked) ${checkbox}.click(); true`);
  await sleepMs(150);

  // Whitespace option label: it ignores whitespace for the comparison, nothing is removed
  const optionLabel = await page.eval(`[...__t.page().querySelectorAll('.input-options-container .checkbox-label')][0].textContent`);
  r.check(`${label}: whitespace option is labelled "ignore"`, ['Leerzeichen ignorieren', 'Ignore whitespace'].includes(optionLabel), json(optionLabel));

  // Left alignment, whitespace and complete word segments (unified and split)
  const oldText = 'kurz\nDie schnelle braune Katze springt.\n\teingerückt\n    vier Leerzeichen\nA';
  const newText = 'kurz\nDie schnelle schwarze Katze läuft.\n\teingerückt\n    vier Leerzeichen\nB\nA';
  await compare(oldText, newText);
  await page.eval(`${checkbox}.click(); true`);
  await page.waitFor(`__t.page().querySelectorAll('.word-diff.diff-removed').length === 2`, 8000);
  await page.waitFor(finished, 8000);
  const unified = await page.eval(layout('.unified-diff-view'));
  const expectedTexts = ['kurz', 'Die schnelle braune Katze springt.', 'Die schnelle schwarze Katze läuft.', '\teingerückt', '    vier Leerzeichen', 'B', 'A'];
  r.check(
    `${label}: unified diff rows are left-aligned, whitespace and word segments kept`,
    leftAligned(unified) && json(unified.map((row) => row.value)) === json(expectedTexts),
    json(unified),
  );
  await page.eval(`${viewButton(1)}.click(); true`);
  await page.waitFor(`!!__t.page().querySelector('.split-diff-view')`, 3000);
  const splitOld = await page.eval(layout('.split-diff-original'));
  const splitNew = await page.eval(layout('.split-diff-new'));
  r.check(
    `${label}: split diff rows are left-aligned on both sides`,
    leftAligned(splitOld) && leftAligned(splitNew) && splitOld.length === 5 && splitNew.length === 6,
    json({ splitOld, splitNew }),
  );

  // Colors and strike-through of the word diff stay as they are
  const style = await page.eval(`(() => {
    const css = (selector, ...props) => { const e = __t.page().querySelector(selector); const s = getComputedStyle(e); return props.map((p) => s[p]); };
    return {
      removedWord: css('.split-diff-original .word-diff.diff-removed', 'backgroundColor', 'textDecorationLine'),
      addedWord: css('.split-diff-new .word-diff.diff-added', 'backgroundColor', 'textDecorationLine'),
      removedRow: css('.split-diff-original .diff-line.diff-removed', 'backgroundColor'),
      addedRow: css('.split-diff-new .diff-line.diff-added', 'backgroundColor'),
    };
  })()`);
  r.check(
    `${label}: word diff colors and strike-through unchanged`,
    json(style) ===
      json({
        removedWord: ['rgba(224, 107, 116, 0.2)', 'line-through'],
        addedWord: ['rgba(152, 195, 121, 0.2)', 'none'],
        removedRow: ['rgba(224, 107, 116, 0.1)'],
        addedRow: ['rgba(152, 195, 121, 0.1)'],
      }),
    json(style),
  );

  // Statistics: the changed line pairs are named as part of added/removed, only with word diff
  const statsText = () => page.eval(`__t.page().querySelector('.diff-stats').textContent`);
  const withWordDiff = await statsText();
  await page.eval(`${checkbox}.click(); true`);
  await sleepMs(200);
  const withoutWordDiff = await statsText();
  r.check(
    `${label}: statistics name the changed line pairs only with word diff, as part of added/removed`,
    /(1 geändertes Zeilenpaar|1 changed line pair)/.test(withWordDiff) && /(hinzugefügt\/entfernt|added\/removed)/.test(withWordDiff) &&
      !/(Zeilenpaar|line pair)/.test(withoutWordDiff) && !/geändert,|changed,/.test(withWordDiff),
    json({ withWordDiff, withoutWordDiff }),
  );

  // Moved lines on both sides of the split view
  await compare('A\nB\nC\nD', 'A\nC\nD\nB');
  const moved = await page.eval(`[...__t.page().querySelectorAll('.split-diff-view .diff-line.diff-moved')].map((l) => l.closest('.split-diff-original') ? 'old:' + l.dataset.line : 'new:' + l.dataset.line).concat([...__t.page().querySelectorAll('.split-diff-view .diff-move-hint')].map(() => 'hint'))`);
  r.check(`${label}: moved line on both sides of the split view with its other position`, json(moved) === json(['old:2', 'new:4', 'hint', 'hint']), json(moved));
  await page.eval(`${viewButton(0)}.click(); true`);
  await sleepMs(150);

  // A valid comparison fails (too complex), then the word diff is switched on: it uses the shown comparison
  await compare('Die Katze schläft', 'Die Katze träumt');
  const lines = Array.from({ length: 12_000 }, (_, i) => `line ${i}`);
  const failed = await compare(lines.join('\n'), [...lines].reverse().join('\n'));
  const rowsAfterFailure = await page.eval(`[...__t.page().querySelectorAll('.unified-diff-view .diff-line-content')].map((c) => c.textContent)`);
  await page.eval(`__t.watchSnacks(); ${checkbox}.click(); true`);
  const wordDone = await page.waitFor(`[...__t.page().querySelectorAll('.word-diff.diff-removed')].map((w) => w.textContent).join() === 'schläft'`, 8000);
  await page.waitFor(finished, 8000);
  await sleepMs(500);
  const toggleSnacks = await page.eval('__t.takeSnacks()');
  r.check(
    `${label}: after a failed valid comparison the word diff uses the shown comparison (failed one not repeated)`,
    failed.length === 1 && failed[0].startsWith('error') && json(rowsAfterFailure) === json(['Die Katze schläft', 'Die Katze träumt']) && wordDone && toggleSnacks.length === 0,
    json({ failed, rowsAfterFailure, toggleSnacks }),
  );
  await page.eval(`${checkbox}.click(); true`);
  await sleepMs(150);
  const next = await compare('x\ny', 'x\nz');
  r.check(`${label}: valid comparison after the failed one`, next.length === 1 && next[0].startsWith('success'), json(next));

  await compare('a', 'a');
  r.check(`${label}: Diff detail checks without errors`, errorsSince(n).length === 0, json(errorsSince(n)));
}

/**
 * Diff page (Paket 7 B3): a running comparison is outdated by a newer click with two empty texts (it shows neither its
 * result nor a message, the shown result stays, the processing state ends; switching the word diff on then uses the
 * shown comparison), a later valid comparison works, and results over 2,000 lines are paged while copying copies all.
 */
export async function checkDiffCancelAndPaging(page, r, label, errorsSince) {
  const n = page.logs.length;
  const json = (value) => JSON.stringify(value);
  const checkbox = `__t.page().querySelector('.word-diff-option input')`;
  const rows = `[...__t.page().querySelectorAll('.unified-diff-view .diff-line')].map((l) => l.querySelector('.diff-line-content').textContent)`;
  const finished = `!!__t.page().querySelector('.mode-toggle')`; // only rendered when not processing
  const compare = async (oldText, newText) => {
    await page.eval(`__t.set(__t.textareas()[0], ${json(oldText)}); true`);
    await sleepMs(150);
    await page.eval(`__t.set(__t.textareas()[1], ${json(newText)}); true`);
    await sleepMs(150);
    await page.eval(`__t.watchSnacks(); __t.page().querySelector('.diff-button').click(); true`);
    await page.waitFor(`__t.snackLog.length > 0`, 8000);
    await page.waitFor(finished, 8000);
    return page.eval('__t.takeSnacks()');
  };
  await page.eval(`__t.nav('diff'); true`);
  await sleepMs(200);
  await page.eval(`__t.page().querySelectorAll('.view-type-options .view-option')[0].click(); if (${checkbox}.checked) ${checkbox}.click(); true`);
  await sleepMs(150);

  // Shown result
  await compare('Die Katze schläft', 'Die Katze träumt');
  const shown = await page.eval(rows);

  // A long comparison (about 98,000,000 work units, below the limit) is outdated by a click with two empty texts
  const lines = Array.from({ length: 9_900 }, (_, i) => `line ${i}`);
  await page.eval(`__t.set(__t.textareas()[0], ${json(lines.join('\n'))}); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.textareas()[1], ${json([...lines].reverse().join('\n'))}); true`);
  await sleepMs(150);
  await page.eval(`(async () => {
    __t.watchSnacks();
    __t.page().querySelector('.diff-button').click();
    __t.set(__t.textareas()[0], '');
    __t.set(__t.textareas()[1], '');
    await new Promise((resolve) => setTimeout(resolve, 50));
    __t.page().querySelector('.diff-button').click();
    return true;
  })()`);
  await sleepMs(3_000); // the old job ends meanwhile (a Rust job cannot be stopped, its late result is discarded)
  const snacks = await page.eval('__t.takeSnacks()');
  const after = await page.eval(rows);
  const ended = await page.eval(finished);
  r.check(
    `${label}: Diff with two empty texts outdates the running comparison -> one error, old result kept, no late result`,
    snacks.length === 1 && snacks[0].startsWith('error') && json(after) === json(shown) && ended,
    `snacks=${json(snacks)} rows=${after.length} finished=${ended}`,
  );

  // Word diff switched on now: computed for the shown comparison (not the cancelled one)
  await page.eval(`__t.watchSnacks(); ${checkbox}.click(); true`);
  const wordDone = await page.waitFor(`[...__t.page().querySelectorAll('.word-diff.diff-removed')].map((w) => w.textContent).join() === 'schläft'`, 8000);
  await page.waitFor(finished, 8000);
  r.check(`${label}: word diff after the cancellation uses the shown comparison`, wordDone && __noSnacks(await page.eval('__t.takeSnacks()')), json(await page.eval(rows)));
  await page.eval(`${checkbox}.click(); true`);
  await sleepMs(150);

  // A later valid comparison works normally
  const nextSnacks = await compare('x\ny', 'x\nz');
  const next = await page.eval(rows);
  r.check(`${label}: valid comparison after the cancellation`, json(next) === json(['x', 'y', 'z']) && nextSnacks.length === 1 && nextSnacks[0].startsWith('success'), `rows=${json(next)} snacks=${json(nextSnacks)}`);

  // Paging: 2,500 result lines, 2,000 shown at first, copy has all
  const many = Array.from({ length: 2_500 }, (_, i) => `neu ${i}`);
  await compare('', many.join('\n'));
  const firstPage = await page.eval(`__t.page().querySelectorAll('.unified-diff-view .diff-line').length`);
  await page.eval(`__t.captureCopy(); __t.page().querySelector('.title-actions .copy-button').click(); true`);
  await page.waitFor(`__t.copied !== null`, 3000);
  const copied = await page.eval('__t.copied');
  await page.eval('__t.releaseCopy(); true');
  await page.eval(`__t.page().querySelector('.diff-more-rows button').click(); true`);
  const allShown = await page.waitFor(`__t.page().querySelectorAll('.unified-diff-view .diff-line').length === 2500 && !__t.page().querySelector('.diff-more-rows')`, 5000);
  const copiedLines = copied.split('\n');
  r.check(
    `${label}: 2,500 result lines -> 2,000 shown, "show more" shows all, copy has all lines`,
    firstPage === 2_000 && allShown && copiedLines.length === 2_500 && copiedLines[0] === '+ neu 0' && copiedLines[2_499] === '+ neu 2499',
    `first=${firstPage} copied=${copiedLines.length}`,
  );

  await compare('a', 'a');
  r.check(`${label}: Diff cancellation and paging checks without errors`, errorsSince(n).length === 0, json(errorsSince(n)));
}

/**
 * Line endings (Paket 6) in the current processing mode (Split, Filter, Remove and Diff in Rust or JS; Sort and the
 * column copy are always JS; Combine uses `combine_columns` in Rust mode). Every input is a CRLF file with a trailing
 * newline imported through "Open File": a textarea would turn CRLF into LF. Results are read from React's props and
 * from the copied text, because `textarea.value` normalizes line breaks to LF as well.
 * Expected: no extra row/line for the trailing newline, CRLF and the trailing newline kept in every result, the
 * imported input unchanged, CRLF vs LF no difference in Diff. Needs "Keep Empty Lines" on and regex mode off.
 */
export async function checkLineEndings(page, r, label, errorsSince) {
  const n = page.logs.length;
  const raw = (expr) => page.eval(`__t.raw(${expr})`);
  const json = (value) => JSON.stringify(value);
  const nav = async (name) => {
    await page.eval(`__t.nav('${name}'); true`);
    await sleepMs(200);
  };
  /** Imports `text` with the n-th Open File button; true once the n-th textarea holds it unchanged */
  const loadFile = async (text, index = 0) => {
    await page.eval(`__t.loadFile(${index}, ${json(text)}); true`);
    return page.waitFor(`__t.raw(__t.textareas()[${index}]) === ${json(text)}`, 3000);
  };
  const setInput = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${json(value)}); true`);
    await sleepMs(150);
  };
  const waitForResult = (expected) => page.waitFor(`__t.raw(__t.textareas()[1]) === ${json(expected)}`, 8000);

  // --- Split: 4 rows (no 5th row for the trailing CRLF), copy and Combine keep CRLF + trailing newline ---
  const splitText = 'A,B\r\nC,D,E\r\n\r\nF,G\r\n';
  const columns = [['A', 'C', '', 'F'], ['B', 'D', '', 'G'], ['', 'E', '', '']];
  await nav('split');
  r.check(`${label}: CRLF file imported unchanged`, await loadFile(splitText), json(await raw('__t.textareas()[0]')));
  await setInput(',');
  await page.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
  const splitDone = await page.waitFor(`JSON.stringify(__t.columns()) === ${json(json(columns))}`, 5000);
  r.check(`${label}: Split CRLF with trailing newline -> no extra row, no '\\r' in values`, splitDone, json(await page.eval('__t.columns()')));

  await page.eval(`__t.captureCopy(); __t.page().querySelectorAll('.result-column')[0].querySelector('.copy-button').click(); true`);
  await page.waitFor(`__t.copied !== null`, 3000);
  const copied = await page.eval('__t.copied');
  r.check(`${label}: copied column keeps CRLF and the trailing newline`, copied === 'A\r\nC\r\n\r\nF\r\n', json(copied));
  await page.eval(`__t.releaseCopy(); true`);

  const combine = await combineColumns(page, [2, 0]);
  const combined = await raw(`__t.page().querySelector('.combine-textarea')`);
  r.check(`${label}: Combine Part 3 + Part 1 uses CRLF, keeps rows and the trailing newline`, combine.used === 2 && combined === ':A\r\nE:C\r\n:\r\n:F\r\n', json(combined));
  await page.eval(`__t.page().querySelector('.combine-clear')?.click(); true`);

  // --- Filter ---
  await nav('filter');
  const filterText = 'apple\r\nbanana\r\napricot\r\n';
  await loadFile(filterText);
  await setInput('ap');
  await page.eval(`__t.page().querySelectorAll('.filter-actions button')[1].click(); true`);
  r.check(`${label}: Filter keeps CRLF and the trailing newline`, await waitForResult('ap\r\nap\r\n'), json(await raw('__t.textareas()[1]')));
  r.check(`${label}: Filter leaves the input unchanged`, (await raw('__t.textareas()[0]')) === filterText, json(await raw('__t.textareas()[0]')));

  // --- Filter "remove matches" (Paket 8 C2): untouched empty/whitespace lines stay, only emptied lines disappear ---
  const filterRemove = `__t.page().querySelectorAll('.filter-actions button')[0].click(); true`;
  const paragraphs = 'abc\r\n\r\nkeep me\r\n   \r\nabc\r\n';
  await loadFile(paragraphs);
  await setInput('x');
  await page.eval(filterRemove);
  r.check(`${label}: Filter remove without match keeps every line, empty lines and the trailing newline`, await waitForResult(paragraphs), json(await raw('__t.textareas()[1]')));
  await setInput('abc');
  await page.eval(filterRemove);
  r.check(
    `${label}: Filter remove drops only the emptied lines, existing empty and whitespace lines stay`,
    await waitForResult('\r\nkeep me\r\n   \r\n'),
    json(await raw('__t.textareas()[1]')),
  );
  await setInput('me');
  await page.eval(filterRemove);
  r.check(`${label}: Filter remove keeps a partly removed line with its rest`, await waitForResult('abc\r\n\r\nkeep \r\n   \r\nabc\r\n'), json(await raw('__t.textareas()[1]')));
  await setInput('');

  // --- Remove (duplicates) ---
  await nav('remove');
  await loadFile('x\r\ny\r\nx\r\nz\r\n');
  await page.eval(`__t.watchSnacks(); __t.page().querySelector('.remove-action-button.duplicates').click(); true`);
  const removed = await waitForResult('x\r\ny\r\nz\r\n');
  await sleepMs(300);
  const removeSnacks = await page.eval('__t.takeSnacks()');
  r.check(
    `${label}: Remove duplicates keeps CRLF and the trailing newline, 1 line removed`,
    removed && removeSnacks.length === 1 && removeSnacks[0].startsWith('success') && /\b1\b/.test(removeSnacks[0]),
    `${json(await raw('__t.textareas()[1]'))} ${json(removeSnacks)}`
  );

  // --- Sort (JS) ---
  await nav('sort');
  await loadFile('b\r\nc\r\na\r\n');
  await page.eval(`__t.page().querySelector('.sort-button').click(); true`);
  r.check(`${label}: Sort keeps CRLF and the trailing newline, no empty line`, await waitForResult('a\r\nb\r\nc\r\n'), json(await raw('__t.textareas()[1]')));

  // --- Diff: CRLF file with trailing newline vs. the same text typed (LF, no trailing newline) ---
  await nav('diff');
  await loadFile('one\r\ntwo\r\nthree\r\n', 0);
  await page.eval(`__t.set(__t.textareas()[1], 'one\\ntwo\\nthree'); true`);
  await sleepMs(150);
  await page.eval(`__t.watchSnacks(); __t.page().querySelector('.diff-button').click(); true`);
  await page.waitFor(`__t.snackLog.length > 0`, 8000);
  const diffDone = await page.waitFor(`__t.page().querySelectorAll('.diff-line').length === 3`, 3000);
  const changed = await page.eval(`__t.page().querySelectorAll('.diff-line.diff-added, .diff-line.diff-removed, .diff-line.diff-moved').length`);
  r.check(`${label}: Diff CRLF vs LF -> 3 unchanged lines, no difference`, diffDone && changed === 0, `lines=${await page.eval(`__t.page().querySelectorAll('.diff-line').length`)} changed=${changed}`);

  // --- Diff (Paket 7): more new than old lines (the old worker cut the new text) and a move with both positions ---
  await page.eval(`__t.set(__t.textareas()[0], 'A\\nB'); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.textareas()[1], 'B\\nA\\nC\\nD'); true`);
  await sleepMs(150);
  await page.eval(`__t.watchSnacks(); __t.page().querySelector('.diff-button').click(); true`);
  await page.waitFor(`__t.snackLog.length > 0`, 8000);
  const lineTexts = `[...__t.page().querySelectorAll('.unified-diff-view .diff-line')].map((l) => [l.className.replace('diff-line', '').trim(), l.dataset.oldLine + '/' + l.dataset.newLine, l.querySelector('.diff-line-content').textContent, l.querySelector('.diff-move-hint') ? 'hint' : ''].join('|'))`;
  const expectedLines = ['diff-removed diff-moved|1/|A|hint', '|2/1|B|', 'diff-added diff-moved|/2|A|hint', 'diff-added|/3|C|', 'diff-added|/4|D|'];
  const longerDone = await page.waitFor(`JSON.stringify(${lineTexts}) === ${JSON.stringify(JSON.stringify(expectedLines))}`, 3000);
  const stats = await page.eval(`JSON.stringify({ ...__t.page().querySelector('.diff-stats')?.dataset })`);
  r.check(
    `${label}: Diff keeps every new line, a move keeps both positions and is counted once`,
    longerDone && stats === JSON.stringify({ unchanged: '1', added: '2', removed: '0', moved: '1', changed: '0', wordDiff: 'false' }),
    `lines=${json(await page.eval(lineTexts))} stats=${stats}`,
  );

  r.check(`${label}: line-ending checks without errors`, errorsSince(n).length === 0, json(errorsSince(n)));

  // The source text is shared by the pages: leave the usual one for the following checks
  await nav('split');
  await page.eval(`__t.set(__t.textareas()[0], 'a_b'); true`);
  await sleepMs(150);
  await setInput('_');
}

/**
 * Holds worker answers while `__t.sortGate.on` (installed on `Worker.prototype.onmessage`, so also pooled workers of
 * BaseService are covered): a test starts a sort, changes the input while the answer is held and then delivers it late,
 * unchanged or replaced by other data. Deterministic: the answer arrives exactly when the test releases it.
 */
const SORT_GATE_INSTALL = `(() => {
  if (__t.sortGate) return true;
  const desc = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage');
  __t.sortGate = { on: false, held: [], desc };
  Object.defineProperty(Worker.prototype, 'onmessage', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get.call(this); },
    set(fn) {
      const worker = this;
      desc.set.call(this, typeof fn === 'function'
        ? (event) => (__t.sortGate?.on ? __t.sortGate.held.push({ fn, worker, event }) : fn.call(worker, event))
        : fn);
    },
  });
  return true;
})()`;
const SORT_GATE_UNINSTALL = `(() => { Object.defineProperty(Worker.prototype, 'onmessage', __t.sortGate.desc); __t.sortGate = null; return true; })()`;
/** Delivers the held answers (or `data` instead of them), then lets promises, React and one frame run. */
const SORT_GATE_RELEASE = `async (data) => {
  const held = __t.sortGate.held.splice(0);
  __t.sortGate.on = false;
  held.forEach((h) => h.fn.call(h.worker, data === undefined ? h.event : { data }));
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  return held.length;
}`;

/**
 * Paket 9 C2 review: text, method or a used case option changed while a sort runs (no new sort started). The old job
 * must neither replace the shown result nor show a success or error message, the loading state must end, and a later
 * valid sort must work and not be affected by the late answer. A case change the running method ignores (line
 * length) keeps the job valid.
 */
async function checkSortInputChangedWhileRunning(page, r, label, ui) {
  const { loadFile, selectMethod, setCase, sort, result, waitForResult, outdated, snacks } = ui;
  const json = (value) => JSON.stringify(value);
  const busy = () => page.eval(`__t.page().querySelector('.sort-button').getAttribute('aria-busy')`);
  /** Starts a sort whose worker answer is held; true once it is held. */
  const startHeld = async () => {
    await snacks();
    await page.eval(`__t.sortGate.on = true; __t.page().querySelector('.sort-button').click(); true`);
    return page.waitFor(`__t.sortGate.held.length === 1`, 8000);
  };
  const release = (data) => page.eval(`(${SORT_GATE_RELEASE})(${data === undefined ? 'undefined' : json(data)})`);
  /** The page state after a late answer of an outdated job: nothing changed, nothing reported, not loading. */
  const unchanged = async (shownBefore) => {
    const state = { result: await result(), outdated: await outdated(), busy: await busy(), snacks: await snacks() };
    return { ok: state.result === shownBefore && state.outdated && state.busy === 'false' && state.snacks.length === 0, state };
  };

  await page.eval(SORT_GATE_INSTALL);
  await selectMethod('alphabetical');
  await setCase(true);
  await loadFile('b\na');
  await sort();
  await waitForResult('a\nb');

  // 1. Text changed while running, late result
  await loadFile('d\nc');
  let held = await startHeld();
  await loadFile('f\ne');
  let released = await release();
  let after = await unchanged('a\nb');
  r.check(`${label}: Sort text changed while running: late result not applied, no message, not loading`, held && released === 1 && after.ok, json(after.state));
  await snacks();
  await sort();
  const nextDone = await waitForResult('e\nf');
  r.check(`${label}: Sort after the text change works`, nextDone && (await snacks()).filter((s) => s.startsWith('success')).length === 1, json(await result()));

  // 2. Method changed while running, late result
  await loadFile('bb\na\nccc');
  held = await startHeld();
  await selectMethod('lengthDesc');
  released = await release();
  after = await unchanged('e\nf');
  r.check(`${label}: Sort method changed while running: late result not applied, no message, not loading`, held && released === 1 && after.ok, json(after.state));
  await sort();
  r.check(`${label}: Sort with the new method after the change works`, await waitForResult('ccc\nbb\na'), json(await result()));

  // 3. Used case option changed while running, late result
  await selectMethod('alphabetical');
  await loadFile('B\nb\nA\na');
  held = await startHeld();
  await setCase(false);
  released = await release();
  after = await unchanged('ccc\nbb\na');
  r.check(`${label}: Sort case option changed while running: late result not applied, no message, not loading`, held && released === 1 && after.ok, json(after.state));
  await sort();
  r.check(`${label}: Sort with the changed case option works`, await waitForResult('A\na\nB\nb'), json(await result()));

  // 4. Text changed while running, late error
  await loadFile('y\nx');
  held = await startHeld();
  await loadFile('w\nz');
  released = await release({ success: false, type: 'error', errorKind: 'worker', error: 'errors.processingError', result: null });
  after = await unchanged('A\na\nB\nb');
  r.check(`${label}: Sort text changed while running: late error not reported`, held && released === 1 && after.ok, json(after.state));

  // 5. A newer valid sort runs first, the outdated answer arrives afterwards
  await loadFile('q\np');
  held = await startHeld();
  await loadFile('s\nr');
  await snacks();
  await sort(); // gate is still on: this answer is held too
  await page.waitFor(`__t.sortGate.held.length === 2`, 8000);
  // Deliver the newer answer first, then the outdated one
  await page.eval(`(() => { const [older, newer] = __t.sortGate.held.splice(0); __t.sortGate.on = false; newer.fn.call(newer.worker, newer.event); older.fn.call(older.worker, older.event); return true; })()`);
  const newerDone = await waitForResult('r\ns');
  await page.eval(`(${SORT_GATE_RELEASE})()`);
  const newerSnacks = await snacks();
  r.check(
    `${label}: Sort outdated answer after a newer valid sort changes nothing`,
    held && newerDone && (await result()) === 'r\ns' && !(await outdated()) && newerSnacks.length === 1 && newerSnacks[0].startsWith('success'),
    json(newerSnacks)
  );

  // 6. Case change the running method ignores (line length): the job stays valid and is applied
  await selectMethod('lengthAsc');
  await loadFile('ccc\na\nbb');
  held = await startHeld();
  // The checkbox is disabled for line length; it is switched programmatically to change the (ignored) option
  const toggled = await page.eval(`(() => { const i = __t.page().querySelector('.input-box input[type=checkbox]'); i.disabled = false; i.click(); i.disabled = true; return i.checked; })()`);
  const busyWhileHeld = await busy();
  released = await release();
  const applied = { result: await result(), outdated: await outdated(), busy: await busy(), snacks: await snacks() };
  r.check(
    `${label}: Sort ignored case change while running (line length): result applied`,
    held && toggled === true && busyWhileHeld === 'true' && released === 1 && applied.result === 'a\nbb\nccc' && !applied.outdated &&
      applied.busy === 'false' && applied.snacks.length === 1 && applied.snacks[0].startsWith('success'),
    json(applied)
  );

  await page.eval(SORT_GATE_UNINSTALL);
}

// Golden sort results of Paket 9 C1, checked in the real UI (Paket 9 C2). `methods` is the order of the dropdown.
const SORT_FIXTURES = JSON.parse(readFileSync(new URL('../../fixtures/sort-cases.json', import.meta.url), 'utf8'));
const SORT_UI_CASES = [
  'natural: decimals after whitespace (prices)',
  'natural: negative and positive integers',
  'natural: numerically equal spellings in one list',
  'natural: multi-part identifiers stay digit runs',
  'natural CS: same collation as alphabetical, independent of input order',
  'alphabetical: emoji and other scripts (CLDR root order)',
  'alphabetical CI: case variants are equal keys and keep input order',
  'alphabetical: no implicit trim, leading and trailing spaces are kept',
  'length: code points, not UTF-16 units',
  'line endings: mixed, the most frequent one wins',
  'blank lines: Paket 8 whitespace set (U+0085, U+00A0 blank; U+FEFF, U+200B not)',
  'blank lines: an empty line moved to the end gets a trailing newline (CRLF)',
];

/**
 * Sort page (Paket 9 C2) in the current processing mode: Sort always runs the TypeScript sort in the sort worker (also
 * in Rust mode). Golden cases, exact display and copy, outdated results, the case option, empty and whitespace-only
 * input, rapid clicks (latest job wins, one message) and a large text.
 */
export async function checkSort(page, r, label, errorsSince) {
  const n = page.logs.length;
  const json = (value) => JSON.stringify(value);
  const result = () => page.eval(`__t.raw(__t.textareas()[1])`);
  const waitForResult = (expected) => page.waitFor(`__t.raw(__t.textareas()[1]) === ${json(expected)}`, 8000);
  const loadFile = async (text) => {
    await page.eval(`__t.loadFile(0, ${json(text)}); true`);
    return page.waitFor(`__t.raw(__t.textareas()[0]) === ${json(text)}`, 3000);
  };
  const selectMethod = async (method) => {
    const index = SORT_FIXTURES.methods.indexOf(method);
    await page.eval(`__t.page().querySelector('.custom-select').click(); true`);
    await sleepMs(200);
    await page.eval(`document.querySelectorAll('.select-dropdown li')[${index}].click(); true`);
    await sleepMs(150);
  };
  const caseBox = () => page.eval(`(() => { const i = __t.page().querySelector('.input-box input[type=checkbox]'); return { checked: i.checked, disabled: i.disabled }; })()`);
  const setCase = async (value) => {
    await page.eval(`(() => { const i = __t.page().querySelector('.input-box input[type=checkbox]'); if (i.checked !== ${value}) i.click(); })(); true`);
    await sleepMs(100);
  };
  const sort = () => page.eval(`__t.page().querySelector('.sort-button').click(); true`);
  const outdated = () => page.eval(`!!__t.page().querySelector('.sort-result-outdated')`);
  const snacks = () => page.eval('__t.takeSnacks()');

  await page.eval(`__t.nav('sort'); __t.watchSnacks(); true`);
  await sleepMs(250);

  // --- Golden cases (sort-cases.json) through file import (keeps CR/CRLF), exactly as sortText computes them ---
  for (const name of SORT_UI_CASES) {
    const c = SORT_FIXTURES.cases.find((fixture) => fixture.name === name);
    await loadFile(c.input);
    await selectMethod(c.options.method);
    if (!(await caseBox()).disabled) await setCase(c.options.caseSensitive);
    await snacks();
    await sort();
    const done = await waitForResult(c.expected);
    r.check(`${label}: Sort ${name}`, done && !(await outdated()), json(await result()));
  }
  r.check(
    `${label}: Sort runs in the sort worker`,
    await page.eval(`performance.getEntriesByType('resource').some((e) => /SortWorker/.test(e.name))`)
  );

  // --- Copy: the exact result (CRLF, empty last line + trailing newline of OD-8) ---
  const last = SORT_FIXTURES.cases.find((fixture) => fixture.name === SORT_UI_CASES[SORT_UI_CASES.length - 1]);
  await page.eval(`__t.captureCopy(); __t.page().querySelector('.result-header .copy-button').click(); true`);
  await page.waitFor(`__t.copied !== null`, 3000);
  const copied = await page.eval('__t.copied');
  r.check(`${label}: Sort copy is the exact result`, copied === last.expected, json(copied));
  await page.eval(`__t.releaseCopy(); true`);

  // --- Outdated result: marked when text or options change, the shown result stays until a new sort succeeds ---
  // File import keeps CRLF (typing into a textarea would turn it into LF, which is a different text)
  await loadFile(last.input + '\r\nc');
  r.check(`${label}: Sort result is marked outdated after a text change`, (await outdated()) && (await result()) === last.expected);
  await loadFile(last.input);
  r.check(`${label}: Sort result is current again for the same text and options`, !(await outdated()));
  await selectMethod('alphabeticalReverse');
  r.check(`${label}: Sort result is marked outdated after a method change`, await outdated());
  await sort();
  r.check(`${label}: Sort with the new method replaces the result`, (await waitForResult('b\r\na\r\n\r\n')) && !(await outdated()), json(await result()));

  // --- Case option: disabled for length and random, its value is kept for alphabetical and natural ---
  await selectMethod('natural');
  await setCase(false);
  await selectMethod('lengthAsc');
  const forLength = await caseBox();
  await selectMethod('random');
  const forRandom = await caseBox();
  await selectMethod('alphabetical');
  const back = await caseBox();
  r.check(
    `${label}: Sort case option disabled for length/random, value kept`,
    forLength.disabled && !forLength.checked && forRandom.disabled && !forRandom.checked && !back.disabled && !back.checked,
    json({ forLength, forRandom, back })
  );
  // Case-insensitive keeps the input order of B/b and A/a; case-sensitive would give a, A, b, B
  await loadFile('B\nb\nA\na');
  await snacks();
  await sort();
  r.check(`${label}: Sort uses the kept case option (case-insensitive: ties in input order)`, await waitForResult('A\na\nB\nb'), json(await result()));
  await setCase(true);

  // --- Empty input: refused with a warning, no success, the previous result stays ---
  await page.eval(`__t.set(__t.textareas()[0], ''); true`);
  await sleepMs(150);
  await snacks();
  await sort();
  await sleepMs(500);
  const emptySnacks = await snacks();
  r.check(
    `${label}: Sort of an empty text is refused (warning, no success), result kept`,
    emptySnacks.length === 1 && emptySnacks[0].startsWith('warning') && (await result()) === 'A\na\nB\nb' && (await outdated()),
    json(emptySnacks)
  );

  // --- Whitespace-only input: valid data lines ---
  await loadFile('  \n\t');
  await snacks();
  await sort();
  const whitespaceDone = await waitForResult('  \n\t');
  await sleepMs(300);
  const whitespaceSnacks = await snacks();
  r.check(`${label}: Sort of whitespace-only lines succeeds`, whitespaceDone && whitespaceSnacks.length === 1 && whitespaceSnacks[0].startsWith('success'), json(whitespaceSnacks));

  // --- Rapid clicks: the first job is superseded, one result, one message ---
  await loadFile('b\nc\na');
  await snacks();
  await page.eval(`(() => { const b = __t.page().querySelector('.sort-button'); b.click(); b.click(); b.click(); })(); true`);
  const rapidDone = await waitForResult('a\nb\nc');
  await sleepMs(500);
  const rapidSnacks = await snacks();
  r.check(`${label}: Sort rapid clicks: latest job wins, exactly one success message`, rapidDone && rapidSnacks.length === 1 && rapidSnacks[0].startsWith('success'), json(rapidSnacks));

  // --- Large text: 100 000 shuffled lines, natural, through the worker ---
  await selectMethod('natural');
  await page.eval(`(() => {
    const lines = Array.from({ length: 100000 }, (_, i) => 'item ' + i);
    for (let i = lines.length - 1, s = 7; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [lines[i], lines[j]] = [lines[j], lines[i]]; }
    __t.set(__t.textareas()[0], lines.join('\\n'));
  })(); true`);
  await sleepMs(500);
  await snacks();
  await sort();
  const bigDone = await page.waitFor(
    `(() => { const v = __t.raw(__t.textareas()[1]); return !!v && v.startsWith('item 0\\nitem 1\\nitem 2\\n') && v.endsWith('\\nitem 99998\\nitem 99999'); })()`,
    20000
  );
  const bigLines = await page.eval(`__t.raw(__t.textareas()[1]).split('\\n').length`);
  r.check(`${label}: Sort 100 000 lines (natural) in the worker`, bigDone && bigLines === 100000, `lines=${bigLines}`);

  await checkSortInputChangedWhileRunning(page, r, label, { loadFile, selectMethod, setCase, sort, result, waitForResult, outdated, snacks });

  r.check(`${label}: Sort checks without errors`, errorsSince(n).length === 0, json(errorsSince(n)));

  // The source text is shared by the pages: leave the usual one for the following checks
  await page.eval(`__t.set(__t.textareas()[0], 'a_b'); true`);
  await sleepMs(300);
}

// --- Paket 11 Phase B: file import (tests/fixtures/file-io-cases.json, contract docs/analyse/Paket11-PhaseB-Datei-IO-Vertrag.md) ---

const FILE_IO = JSON.parse(readFileSync(new URL('../../fixtures/file-io-cases.json', import.meta.url), 'utf8'));
/** Deterministic ASCII text of `size` bytes (same generator as tests/unit/file-io-fixtures.test.ts). */
const generatedText = (size) => FILE_IO.generator.line.repeat(Math.ceil(size / FILE_IO.generator.line.length)).slice(0, size);
const fileBytes = (c) =>
  c.generate !== undefined ? Buffer.from(generatedText(c.generate), 'latin1') : Buffer.from(c.bytes.split(' ').filter(Boolean).map((h) => parseInt(h, 16)));
/**
 * Text of the uncaught F1 error of OpenFileButton (dev build / production build). Only identifies the errors logged while
 * an F1 scenario runs; it never excuses an error by its text (see `provokedErrors` of checkFileIo).
 */
const HOOK_ERROR = /Invalid hook call|Minified React error #321/;

/**
 * Counts the file reads of the page and can hold their START (`__t.reads.hold`): the FileReader read methods and the
 * Blob read methods (`text`, `arrayBuffer`, `bytes`) are wrapped, so any implementation of the import is covered. A held
 * read starts only when the test releases it, then the browser really reads and decodes the file; nothing is mocked.
 * `settled` counts reads whose result (load, error) was delivered.
 */
const FILE_READ_GATE_INSTALL = `(() => {
  if (__t.reads) return true;
  const g = (__t.reads = { started: 0, settled: 0, hold: false, held: [], restore: [] });
  const done = () => setTimeout(() => g.settled++, 0);
  const wrap = (proto, name, make) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    g.restore.push(() => { proto[name] = orig; });
    proto[name] = make(orig);
  };
  for (const name of ['readAsText', 'readAsArrayBuffer', 'readAsDataURL', 'readAsBinaryString'])
    wrap(FileReader.prototype, name, (orig) => function (...args) {
      g.started++;
      this.addEventListener('loadend', done, { once: true });
      const start = () => orig.apply(this, args);
      if (g.hold) g.held.push(start); else start();
    });
  for (const name of ['text', 'arrayBuffer', 'bytes'])
    wrap(Blob.prototype, name, (orig) => function (...args) {
      g.started++;
      const start = () => orig.apply(this, args);
      const p = g.hold ? new Promise((resolve) => g.held.push(() => resolve(start()))) : start();
      p.then(done, done);
      return p;
    });
  if (__t.dropCount === undefined) {
    __t.dropCount = 0;
    // Capture: the Remove drop handler stops the propagation; the timer runs after the handler
    window.addEventListener('drop', () => setTimeout(() => __t.dropCount++, 0), true);
  }
  window.__fileGen = (n) => ${JSON.stringify(FILE_IO.generator.line)}.repeat(Math.ceil(n / ${FILE_IO.generator.line.length})).slice(0, n);
  return true;
})()`;
const FILE_READ_GATE_UNINSTALL = `(() => { __t.reads?.restore.forEach((f) => f()); __t.reads = null; return true; })()`;

/**
 * Paket 11 Phase B: characterizes the file import with real files (temporary directory, written from the byte fixtures).
 *   - Button: `DOM.setFileInputFiles` on the real input = the path of the Chromium file chooser (a real change event,
 *     no change for the same path again); every case uses its own path.
 *   - Drop (Remove): `Input.dispatchDragEvent` with the real file = Chromium's drag pipeline in the renderer. In Tauri
 *     this is NOT the native OS drop (wry handles that before the WebView, dragDropEnabled), see tests/README.md.
 *   - Read errors are real: a path that does not exist (NotFoundError) or a file deleted before its held read starts.
 *   - Races are a controlled simulation: real reads whose start is held and released in a fixed order.
 * The checks expect the CURRENT behaviour; a case or scenario with `pending` names its target in the check label.
 * Returns `provokedErrors`: the log entries of the F1 hook errors logged while the scenarios "read error on the button"
 * and "replaced import fails late" ran. A runner excludes exactly these entries; every other error, also an equal hook
 * error, stays unexpected.
 */
export async function checkFileIo(page, r, label, errorsSince) {
  const n = page.logs.length;
  const json = (value) => JSON.stringify(value);
  const PREV = FILE_IO.previousText;
  const dir = mkdtempSync(join(tmpdir(), 'mytextsplitter-file-io-'));
  const inputSelector = '.app-container-column:not(.hide-page) .file-upload input[type=file]';
  const nav = async (name) => {
    await page.eval(`__t.nav('${name}'); true`);
    await sleepMs(250);
  };
  const raw = (index) => page.eval(`__t.raw(__t.textareas()[${index}])`);
  const setText = async (index, value) => {
    await page.eval(`__t.set(__t.textareas()[${index}], ${json(value)}); true`);
    return page.waitFor(`__t.raw(__t.textareas()[${index}]) === ${json(value)}`, 3000);
  };
  const textarea = (index, expr) => page.eval(`(() => { const ta = __t.textareas()[${index}]; return ${expr}; })()`);
  const frame = () => page.eval(`new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(true), 0)))`);
  /** All started and released reads delivered their result, then React rendered. */
  const settle = async () => {
    const ok = await page.waitFor(`__t.reads.settled === __t.reads.started - __t.reads.held.filter(Boolean).length`, 20000);
    await frame();
    return ok;
  };
  /** Holds the start of the following reads; their release indices start at 0 for every held group. */
  const hold = (on) => page.eval(`(() => { if (${on}) __t.reads.held = []; __t.reads.hold = ${on}; return true; })()`);
  const heldCount = () => page.eval(`__t.reads.held.filter(Boolean).length`);
  const release = async (i) => {
    await page.eval(`(() => { const f = __t.reads.held[${i}]; __t.reads.held[${i}] = null; f(); return true; })()`);
    return settle();
  };
  const started = () => page.eval('__t.reads.started');
  const snacks = () => page.eval('__t.takeSnacks()');
  /** F1 hook errors logged since `from` (the entries themselves). */
  const hookErrorsSince = (from) => expectedErrorsIn(page.logs, from, page.logs.length, HOOK_ERROR);
  const isException = (l) => l.kind === 'exception';
  /** Errors provoked on purpose, recorded by entry while their scenario runs. */
  const provokedErrors = [];
  /** Writes `content` (string or Buffer) to `dir/<sub>/<name>` and returns the path. */
  const writeFile = (sub, name, content) => {
    mkdirSync(join(dir, sub), { recursive: true });
    const path = join(dir, sub, name);
    writeFileSync(path, content);
    return path;
  };
  /** Chooses `files` with the index-th file input of the visible page (the change event is dispatched synchronously). */
  const choose = async (index, files) => {
    const { root } = await page.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await page.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: inputSelector });
    await page.send('DOM.setFileInputFiles', { files: [].concat(files), nodeId: nodeIds[index] });
  };
  /** Drops the file at `path` onto the index-th textarea; true once the drop event was handled. */
  const dropFile = async (path, index = 0) => {
    const before = await page.eval('__t.dropCount');
    // A point really on the textarea (error snackbars at the top would swallow the drag)
    const at = await page.eval(`(() => { const ta = __t.textareas()[${index}]; ta.scrollIntoView({ block: 'center' });
      const rect = ta.getBoundingClientRect(); const x = Math.round(rect.x + rect.width / 2);
      for (let y = Math.round(rect.bottom - 10); y > rect.top; y -= 10) if (document.elementFromPoint(x, y) === ta) return { x, y };
      return null; })()`);
    if (!at) return false;
    const data = { items: [], files: [path], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await page.send('Input.dispatchDragEvent', { type, ...at, data });
    return page.waitFor(`__t.dropCount > ${before}`, 5000);
  };
  const describe = (e) =>
    'text' in e ? `text ${json(e.text.length > 24 ? e.text.slice(0, 24) + '…' : e.text)}` : 'generatedText' in e ? 'generated text' : 'unchanged' in e ? 'ignored' : `rejected (${e.rejected})`;

  await page.eval(FILE_READ_GATE_INSTALL);
  await page.eval('__t.watchSnacks(); true');
  let dropAvailable = true;
  try {
    // --- Byte fixtures through both import paths ---
    for (const path of ['button', 'drop']) {
      await nav(path === 'button' ? 'split' : 'remove');
      for (const [i, c] of FILE_IO.cases.entries()) {
        const expected = (path === 'button' ? c.expectedButton : c.expectedDrop) ?? c.expected;
        const file = writeFile(`${path}-${i}`, c.file, fileBytes(c));
        await setText(0, PREV);
        await snacks();
        const before = await started();
        if (path === 'button') {
          await choose(0, file);
          await page.waitFor(`__t.reads.started > ${before}`, 3000);
        } else {
          let dropped = false;
          try {
            dropped = await dropFile(file);
          } catch (err) {
            r.check(`${label}: file drop (Input.dispatchDragEvent) available`, false, err.message);
          }
          if (!dropped) {
            dropAvailable = false;
            r.check(`${label}: file drop reaches the Remove textarea`, false, c.name);
            break;
          }
        }
        await settle();
        const want = 'text' in expected ? json(expected.text) : 'generatedText' in expected ? `__fileGen(${c.generate})` : 'null';
        const state = await page.eval(`(() => { const v = __t.raw(__t.textareas()[0]);
          return { prev: v === ${json(PREV)}, matches: v === ${want}, length: v.length, head: v.slice(0, 40) }; })()`);
        const shown = await snacks();
        const errors = shown.filter((s) => s.startsWith('error'));
        const ok =
          'text' in expected || 'generatedText' in expected
            ? state.matches && errors.length === 0
            : 'unchanged' in expected
              ? state.prev && shown.length === 0
              : state.prev && errors.length > 0 && (!expected.message || shown.includes(`error: ${expected.message}`));
        const pending = c.pending?.paths.includes(path) ? ` [current; target: ${describe(c.target)}, pending ${c.pending.decisions.join('+')} ${c.pending.phase}]` : '';
        r.check(`${label}: file ${path} "${c.name}" -> ${describe(expected)}${pending}`, ok, json({ ...state, snacks: shown }));
      }
    }

    const report = (name, observed) => {
      const s = FILE_IO.scenarios.find((x) => x.name === name);
      const pending = s.pending ? ` [current; target differs in ${s.pending.fields.join(', ')}: ${s.pending.decisions.join('+')} ${s.pending.phase}]` : '';
      r.check(`${label}: file import "${name}" (${s.method})${pending}`, json(observed) === json(s.current), `observed ${json(observed)} expected ${json(s.current)}`);
    };

    // --- Same file chosen again (F3, real file chooser path) ---
    await nav('split');
    const fileA = writeFile('reselect', 'a.txt', 'FILE_A\r\n');
    const fileB = writeFile('reselect', 'b.txt', 'FILE_B');
    const same = {};
    const before = await started();
    await choose(0, fileA);
    r.check(`${label}: the file chooser path dispatches the change event synchronously`, (await started()) === before + 1);
    await settle();
    same.first = await raw(0);
    await setText(0, 'EDITED');
    await choose(0, fileA);
    await settle();
    same.againAfterEdit = await raw(0);
    writeFileSync(fileA, 'FILE_A_CHANGED');
    await choose(0, fileA);
    await settle();
    same.againAfterDiskChange = await raw(0);
    await choose(0, fileB);
    await settle();
    await choose(0, fileA);
    await settle();
    same.otherThenSame = await raw(0);
    await nav('sort');
    await nav('split');
    await setText(0, 'EDITED');
    await choose(0, fileA);
    await settle();
    same.afterRemount = await raw(0);
    report('same file chosen again', same);

    // --- Read errors (real: the file does not exist when it is read) ---
    await setText(0, PREV);
    await snacks();
    let from = page.logs.length;
    await choose(0, join(dir, 'missing', 'does-not-exist.txt'));
    await settle();
    const buttonF1 = hookErrorsSince(from);
    provokedErrors.push(...buttonF1);
    report('read error on the button', {
      text: await raw(0),
      errorMessage: (await snacks()).some((s) => s.startsWith('error')),
      hookException: buttonF1.some(isException),
      readOnly: await textarea(0, 'ta.readOnly'),
    });
    if (dropAvailable) {
      await nav('remove');
      await setText(0, PREV);
      await snacks();
      from = page.logs.length;
      await dropFile(join(dir, 'missing', 'does-not-exist.txt'));
      await settle();
      report('read error on the drop', {
        text: await raw(0),
        errorMessage: (await snacks()).some((s) => s.startsWith('error')),
        hookException: hookErrorsSince(from).some(isException),
        readOnly: await textarea(0, 'ta.readOnly'),
      });
    }

    // --- Loading state of the shared target (gated) ---
    await nav('split');
    await setText(0, PREV);
    await hold(true);
    await choose(0, writeFile('loading', 'loaded.txt', 'LOADED'));
    const loading = {
      readOnly: await textarea(0, 'ta.readOnly'),
      busy: await textarea(0, `ta.getAttribute('aria-busy') === 'true'`),
      selectable: await textarea(0, `(ta.focus(), ta.setSelectionRange(0, 4), !ta.disabled && ta.selectionStart === 0 && ta.selectionEnd === 4)`),
    };
    // Real key input (a readOnly textarea refuses it, unlike a programmatically set value)
    await textarea(0, '(ta.focus(), ta.setSelectionRange(ta.value.length, ta.value.length), true)');
    await page.send('Input.insertText', { text: 'X' });
    await frame();
    loading.typingChangesText = (await raw(0)) !== PREV;
    loading.fileInputEnabled = await page.eval(`!document.querySelector(${json(inputSelector)}).disabled`);
    await hold(false);
    await release(0);
    loading.text = await raw(0);
    loading.readOnlyAfter = await textarea(0, 'ta.readOnly');
    loading.busyAfter = await textarea(0, `ta.getAttribute('aria-busy') === 'true'`);
    report('loading state of the shared target', loading);

    // --- Latest import wins (gated: real reads, their start released in a fixed order) ---
    await setText(0, PREV);
    await hold(true);
    await choose(0, writeFile('race', 'a.txt', 'RACE_A'));
    await choose(0, writeFile('race', 'b.txt', 'RACE_B'));
    const raceHeld = await heldCount();
    await hold(false);
    await release(1);
    const race = { afterB: await raw(0) };
    await release(0);
    race.afterA = await raw(0);
    r.check(`${label}: both overlapping reads were held`, raceHeld === 2, `held=${raceHeld}`);
    report('newer file replaces a running import', race);

    const lateA = writeFile('race-error', 'a.txt', 'RACE_A');
    await setText(0, PREV);
    await snacks();
    await hold(true);
    await choose(0, lateA);
    await choose(0, writeFile('race-error', 'b.txt', 'RACE_B'));
    await hold(false);
    await release(1);
    unlinkSync(lateA);
    from = page.logs.length;
    await release(0);
    const lateF1 = hookErrorsSince(from);
    provokedErrors.push(...lateF1);
    report('replaced import fails late', {
      afterA: await raw(0),
      errorMessage: (await snacks()).some((s) => s.startsWith('error')),
      hookException: lateF1.some(isException),
    });

    // Negative check of the classification with the real entries: exactly one hook exception per F1 scenario is
    // recorded, and an entry with the same text logged elsewhere (a copy, i.e. another log entry) stays unexpected
    const f1Today = FILE_IO.scenarios.find((s) => s.name === 'read error on the button').current.hookException;
    const elsewhere = provokedErrors.map((l) => ({ ...l }));
    r.check(
      `${label}: only the hook errors of the two F1 scenarios are expected, an equal error elsewhere is not`,
      buttonF1.filter(isException).length === (f1Today ? 1 : 0) &&
        lateF1.filter(isException).length === (f1Today ? 1 : 0) &&
        withoutExpected(provokedErrors, provokedErrors).length === 0 &&
        withoutExpected([...provokedErrors, ...elsewhere], provokedErrors).length === elsewhere.length,
      json({ button: buttonF1.length, late: lateF1.length })
    );

    if (dropAvailable) {
      await nav('remove');
      await setText(0, PREV);
      await hold(true);
      await choose(0, writeFile('shared', 'a.txt', 'RACE_A'));
      await dropFile(writeFile('shared', 'b.txt', 'RACE_B'));
      const shared = { readOnlyWhileLoading: await textarea(0, 'ta.readOnly') };
      await hold(false);
      await release(1);
      shared.afterB = await raw(0);
      await release(0);
      shared.afterA = await raw(0);
      report('button and drop share the Remove target', shared);
    }

    // --- Independent targets (Diff) and navigation during an import ---
    await nav('diff');
    await setText(0, 'OLD_PREV');
    await setText(1, 'NEW_PREV');
    await hold(true);
    await choose(0, writeFile('diff', 'old.txt', 'OLD_FILE'));
    const diff = { oldReadOnly: await textarea(0, 'ta.readOnly'), newReadOnlyWhileOldLoads: await textarea(1, 'ta.readOnly') };
    await choose(1, writeFile('diff', 'new.txt', 'NEW_FILE'));
    diff.newReadOnly = await textarea(1, 'ta.readOnly');
    await hold(false);
    await release(0);
    await release(1);
    diff.oldText = await raw(0);
    diff.newText = await raw(1);
    report('independent Diff targets', diff);

    await nav('split');
    await setText(0, PREV);
    await hold(true);
    await choose(0, writeFile('nav', 'shared.txt', 'NAV_FILE'));
    await nav('sort');
    const navShared = { sortReadOnlyWhileLoading: await textarea(0, 'ta.readOnly') };
    await hold(false);
    await release(0);
    navShared.sortText = await raw(0);
    navShared.readOnlyAfter = await textarea(0, 'ta.readOnly');
    report('navigation during an import into the shared text', navShared);

    await nav('split');
    await setText(0, PREV);
    await nav('diff');
    from = page.logs.length;
    await hold(true);
    await choose(1, writeFile('nav', 'local.txt', 'LOCAL_FILE'));
    await nav('split');
    await hold(false);
    await release(0);
    const navLocal = { splitText: await raw(0), splitReadOnly: await textarea(0, 'ta.readOnly'), errors: errorsSince(from).length };
    await nav('diff');
    navLocal.newTextAfterReturn = await raw(1);
    report('navigation during an import into the new Diff text', navLocal);

    // --- Cancelled file dialog (intercepted chooser, opened with a user gesture) ---
    await nav('split');
    const cancelA = writeFile('cancel', 'a.txt', 'FILE_A');
    await choose(0, cancelA);
    await settle();
    await setText(0, 'EDITED');
    let opened = false;
    try {
      await page.send('Page.setInterceptFileChooserDialog', { enabled: true });
      const chooser = new Promise((resolve) => {
        const off = page.on('Page.fileChooserOpened', () => (off(), resolve(true)));
        setTimeout(() => (off(), resolve(false)), 3000);
      });
      await page.send('Runtime.evaluate', { expression: `document.querySelector(${json(inputSelector)}).click()`, userGesture: true });
      opened = await chooser;
    } finally {
      await page.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    }
    r.check(`${label}: file chooser opened (intercepted) with a user gesture`, opened);
    // No file chosen: no change event; Chromium fires 'cancel' on the input when the native dialog is closed
    await page.eval(`document.querySelector(${json(inputSelector)}).dispatchEvent(new Event('cancel', { bubbles: true })); true`);
    await settle();
    const cancel = {
      text: await raw(0),
      readOnly: await textarea(0, 'ta.readOnly'),
      busy: await textarea(0, `ta.getAttribute('aria-busy') === 'true'`),
    };
    await choose(0, cancelA);
    await settle();
    cancel.sameFileAfterCancel = await raw(0);
    report('cancelled file dialog', cancel);

    const unexpected = withoutExpected(errorsSince(n), provokedErrors);
    r.check(`${label}: file import checks without unexpected errors`, unexpected.length === 0, json(unexpected));
  } finally {
    await page.eval(`__t.reads && (__t.reads.hold = false, __t.reads.held.forEach((f) => f?.()), true)`).catch(() => {});
    await page.eval(FILE_READ_GATE_UNINSTALL).catch(() => {});
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  // The source text is shared by the pages: leave the usual one for the following checks
  await nav('split');
  await setText(0, 'a_b');
  return { provokedErrors };
}
