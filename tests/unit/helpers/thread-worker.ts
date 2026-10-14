// Entry point of a Node worker thread that hosts one app worker module (`workerData.module`) like a Web Worker:
// `self.postMessage` -> parent, parent messages -> `self.onmessage`. Used by worker-termination.test.ts.
import './setup.ts'; // resolve hook for the extensionless imports of the app sources (per thread)
import { parentPort, workerData } from 'node:worker_threads';

const g = globalThis as any;
g.self = { postMessage: (message: unknown) => parentPort!.postMessage(message), onmessage: null };
await import(workerData.module);
parentPort!.on('message', (data) => g.self.onmessage?.({ data }));
