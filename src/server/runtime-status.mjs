/** In-memory operational hints for a local testnet service; not proof of payment. */
export function createRuntimeStatus({ webhookEnabled, now = Date.now, staleAfterMs = 30000 }) {
  const initial = () => ({ lastSuccess: null, lastAttempt: null, failed: false, busy: false });
  const state = { scanner: initial(), webhook: initial() };
  const startedAt = now();
  function track(name, action) {
    if (!Object.hasOwn(state, name) || typeof action !== 'function') throw new TypeError('Invalid worker');
    return async () => {
      const entry = state[name]; entry.lastAttempt = now();
      try {
        const result = await action();
        entry.busy = name === 'scanner' && result?.status !== 'ok';
        entry.failed = false;
        if (!entry.busy) entry.lastSuccess = now();
        return result;
      } catch (error) { entry.failed = true; throw error; }
    };
  }
  function describe(name) {
    if (name === 'webhook' && !webhookEnabled) return { state: 'disabled', lastSuccess: null };
    const entry = state[name], reference = entry.lastSuccess ?? startedAt;
    const stateName = entry.failed || entry.busy || now() - reference > staleAfterMs ? 'delayed' : entry.lastSuccess === null ? 'starting' : 'running';
    return { state: stateName, lastSuccess: entry.lastSuccess === null ? null : new Date(entry.lastSuccess).toISOString() };
  }
  return { track, snapshot: () => ({ scanner: describe('scanner'), webhook: describe('webhook') }) };
}
