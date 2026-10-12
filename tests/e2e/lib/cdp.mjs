// Minimal Chrome DevTools Protocol client (Node >= 22: global fetch + WebSocket, no dependencies).
// Works with Chrome/Edge (browser tests) and WebView2 (Tauri tests on Windows).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lists the debuggable targets of a CDP endpoint, or `null` if the endpoint is not reachable. */
export async function listTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    return await res.json();
  } catch {
    return null;
  }
}

/** Connects to the first target matching `pick` and returns a small page API. */
export async function attach(port, pick = (t) => t.type === 'page', timeout = 15000) {
  let target;
  const start = Date.now();
  while (!target && Date.now() - start < timeout) {
    target = (await listTargets(port))?.find(pick);
    if (!target) await sleep(200);
  }
  if (!target) throw new Error(`No matching CDP target on port ${port}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  /** Console messages, exceptions and browser log entries of this target. */
  const logs = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push({ kind: `console.${msg.params.type}`, text });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push({ kind: 'exception', text: d.exception?.description ?? d.text });
    } else if (msg.method === 'Log.entryAdded') {
      logs.push({ kind: `log.${msg.params.entry.level}`, text: msg.params.entry.text });
    }
    listeners.forEach((l) => l(msg));
  });
  ws.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('CDP connection closed'));
    pending.clear();
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const waitForLoad = () =>
    new Promise((resolve) => {
      const listener = (m) => {
        if (m.method === 'Page.loadEventFired') {
          listeners.delete(listener);
          resolve();
        }
      };
      listeners.add(listener);
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const page = {
    logs,
    async goto(url) {
      const loaded = waitForLoad();
      await send('Page.navigate', { url });
      await loaded;
    },
    async reload() {
      const loaded = waitForLoad();
      await send('Page.reload', {});
      await loaded;
    },
    /** Evaluates an expression in the page (promises are awaited, results returned by value). */
    async eval(expression) {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
      }
      return res.result.value;
    },
    async waitFor(expression, timeout = 10000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await page.eval(expression).catch(() => false)) return true;
        await sleep(100);
      }
      return false;
    },
    close() {
      ws.close();
    },
  };
  return page;
}
