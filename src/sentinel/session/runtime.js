/** Boot-time handle so OWNER inbox can read session state. No reconnect timers. */
import { getSessionInboundState } from '../sessionInbound.js';

let runtime = { adapter: null, transportId: 'demo' };

export function setSessionRuntime(next) {
  runtime = next || { adapter: null, transportId: 'demo' };
  return runtime;
}

export function getSessionRuntime() {
  return runtime;
}

export function publicSessionStatus() {
  const adapter = runtime.adapter;
  const snap = adapter && typeof adapter.getState === 'function' ? adapter.getState() : { state: 'STOPPED', qrAvailable: false, qrSeq: 0, creds: false };
  const health = adapter && typeof adapter.health === 'function' ? adapter.health() : { available: false, state: 'STOPPED' };
  const inbound = getSessionInboundState();
  return {
    transport: runtime.transportId || 'demo',
    state: snap.state,
    qrAvailable: Boolean(snap.qrAvailable),
    qrSeq: snap.qrSeq || 0,
    creds: Boolean(snap.creds),
    catchup: inbound.catchup || 'PENDING',
    receivedPendingNotifications: Boolean(inbound.receivedPendingNotifications),
    health,
  };
}
