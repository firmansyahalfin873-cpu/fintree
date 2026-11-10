import { setTimeout as delay } from 'node:timers/promises';

/** Run sequential polling cycles until stopped; transient errors retry with backoff. */
export async function runScannerLoop({ signal, runCycle, onError = () => {}, intervalMs = 5000, maxDelayMs = 60000, sleep = delay }) {
  if (!signal || typeof runCycle !== 'function' || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || !Number.isSafeInteger(maxDelayMs) || maxDelayMs < intervalMs) throw new TypeError('Invalid scanner loop configuration');
  let failures = 0;
  while (!signal.aborted) {
    try { await runCycle(); failures = 0; }
    catch (error) { failures++; onError(error); }
    if (signal.aborted) break;
    const wait = Math.min(maxDelayMs, intervalMs * 2 ** Math.min(failures, 16));
    try { await sleep(wait, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
}
