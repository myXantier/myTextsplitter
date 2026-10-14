// DOM helpers for driving the myTextsplitter UI through CDP (installed as `window.__t` in the page).

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

  // --- Diff (Paket 7): more new than old lines (the old worker cut the new text) and a move (shown as - / +) ---
  await page.eval(`__t.set(__t.textareas()[0], 'A\\nB'); true`);
  await sleepMs(150);
  await page.eval(`__t.set(__t.textareas()[1], 'B\\nA\\nC\\nD'); true`);
  await sleepMs(150);
  await page.eval(`__t.watchSnacks(); __t.page().querySelector('.diff-button').click(); true`);
  await page.waitFor(`__t.snackLog.length > 0`, 8000);
  // Removed lines: class only (the legacy word highlighting renders them together with another line's words, B2/B3)
  const lineTexts = `[...__t.page().querySelectorAll('.unified-diff-view .diff-line')].map((l) => { const type = l.className.replace('diff-line', '').trim(); return type === 'diff-removed' ? type : type + ':' + l.querySelector('.diff-line-content').textContent; })`;
  const expectedLines = ['diff-removed', ':B', 'diff-added:A', 'diff-added:C', 'diff-added:D'];
  const longerDone = await page.waitFor(`JSON.stringify(${lineTexts}) === ${JSON.stringify(JSON.stringify(expectedLines))}`, 3000);
  const stats = await page.eval(`__t.page().querySelector('.diff-stats')?.textContent ?? ''`);
  r.check(
    `${label}: Diff keeps every new line, move shown as removed + added`,
    longerDone && stats.replace(/\s+/g, ' ').trim() === '2 added, 0 removed, 1 moved (shown as - / +)',
    `lines=${json(await page.eval(lineTexts))} stats=${json(stats)}`,
  );

  r.check(`${label}: line-ending checks without errors`, errorsSince(n).length === 0, json(errorsSince(n)));

  // The source text is shared by the pages: leave the usual one for the following checks
  await nav('split');
  await page.eval(`__t.set(__t.textareas()[0], 'a_b'); true`);
  await sleepMs(150);
  await setInput('_');
}
