/**
 * Transport selector (M1 contract, M2 session sendFn).
 *
 * Official send interface for the outbox worker. Selection is explicit.
 * Session is NEVER the default. Cloud + DEMO are unchanged when unset.
 *
 * Default (unset SENTINEL_TRANSPORT):
 *   isLive() → cloud (deliverToMeta)
 *   else     → demo  (demoDeliver)
 *
 * This module does not import a session library and does not call Meta.
 */
export const TRANSPORT_IDS = Object.freeze(['demo', 'cloud', 'session']);

export const CAPABILITIES = Object.freeze({
  demo: Object.freeze({
    text: true,
    buttons: true,
    list: true,
    image: true,
    template: true,
    typing: false,
    read_receipt: false,
    mediaDownload: false,
    interactiveNative: true,
    live_send: false,
    activated: true,
  }),
  cloud: Object.freeze({
    text: true,
    buttons: true,
    list: true,
    image: true,
    template: true,
    typing: true,
    read_receipt: true,
    mediaDownload: true,
    interactiveNative: true,
    live_send: true,
    activated: true,
  }),
  session: Object.freeze({
    text: true,
    buttons: false,
    list: false,
    image: true,
    template: false,
    typing: true,
    read_receipt: true,
    mediaDownload: false,
    interactiveNative: false,
    live_send: false,
    activated: false,
  }),
});

export function requestedTransportId(env = process.env, live) {
  const raw = String(env.SENTINEL_TRANSPORT || '').trim().toLowerCase();
  if (raw === 'demo' || raw === 'cloud' || raw === 'session') return raw;
  if (raw) return 'invalid';
  const liveNow = typeof live === 'boolean'
    ? live
    : Boolean(env.WHATSAPP_TOKEN && env.PHONE_NUMBER_ID);
  return liveNow ? 'cloud' : 'demo';
}

export async function sessionNotActivatedSend() {
  const e = new Error('SESSION_TRANSPORT_NOT_ACTIVATED');
  e.code = 'SESSION_TRANSPORT_NOT_ACTIVATED';
  throw e;
}

/**
 * Resolve the worker sendFn. Callers inject cloud/demo/session deliver
 * functions so this file never imports adapters (no cycle, no hidden HTTP).
 * Never returns two sendFns — one transport only.
 */
export function resolveTransport({
  env = process.env,
  live,
  deliverToMeta,
  demoDeliver,
  sessionSendFn,
} = {}) {
  const requested = requestedTransportId(env, live);
  if (requested === 'invalid') {
    return {
      id: 'invalid',
      requested,
      activated: false,
      sendFn: sessionNotActivatedSend,
      capabilities: Object.freeze({}),
      error: 'UNKNOWN_TRANSPORT',
    };
  }
  if (requested === 'session') {
    const liveFn = typeof sessionSendFn === 'function';
    return {
      id: 'session',
      requested,
      activated: liveFn,
      sendFn: liveFn ? sessionSendFn : sessionNotActivatedSend,
      capabilities: Object.freeze({
        ...CAPABILITIES.session,
        activated: liveFn,
        live_send: liveFn,
      }),
    };
  }
  const liveNow = typeof live === 'boolean'
    ? live
    : Boolean(env.WHATSAPP_TOKEN && env.PHONE_NUMBER_ID);
  if (requested === 'cloud') {
    if (!liveNow) {
      return {
        id: 'demo',
        requested: 'cloud',
        activated: true,
        sendFn: demoDeliver,
        capabilities: CAPABILITIES.demo,
        note: 'cloud without Meta creds — DEMO fallback (existing isLive() behavior)',
      };
    }
    return {
      id: 'cloud',
      requested,
      activated: true,
      sendFn: deliverToMeta,
      capabilities: CAPABILITIES.cloud,
    };
  }
  return {
    id: 'demo',
    requested,
    activated: true,
    sendFn: demoDeliver,
    capabilities: CAPABILITIES.demo,
  };
}

export function metaSideEffectsAllowed(env = process.env, live) {
  return requestedTransportId(env, live) === 'cloud'
    && (typeof live === 'boolean' ? live : Boolean(env.WHATSAPP_TOKEN && env.PHONE_NUMBER_ID));
}
