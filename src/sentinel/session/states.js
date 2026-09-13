/** Explicit session adapter states. Adapter-local. Not humanPaced/sessionHealth.js. */

export const STATES = Object.freeze([
  'STOPPED',
  'STARTING',
  'NEEDS_QR',
  'CONNECTING',
  'CONNECTED',
  'DEGRADED',
  'RECONNECTING',
  'AUTH_REQUIRED',
  'CORRUPTED',
  'DISABLED',
]);

export function createMachine(onChange) {
  let state = 'STOPPED';
  const history = [];

  function set(next, reason) {
    if (!STATES.includes(next)) throw new Error('UNKNOWN_STATE:' + next);
    const prev = state;
    state = next;
    const rec = { at: new Date().toISOString(), prev, next, reason: String(reason || '').slice(0, 160) };
    history.push(rec);
    if (typeof onChange === 'function') onChange(rec);
    return rec;
  }

  return {
    get state() { return state; },
    history: () => history.slice(),
    set,
  };
}
