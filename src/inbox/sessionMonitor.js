/**
 * Same OWNER session-status view, filled from publicSessionStatus + audit types.
 * No QR payload, no credentials, no message bodies.
 */
import { isLive } from '../config.js';
import { auditTail } from '../sentinel/audit.js';
import { peekState } from '../sentinel/killswitch.js';
import { publicSessionStatus } from '../sentinel/session/runtime.js';
import { maskedMeIdentity } from '../sentinel/session/store.js';
import { sessionMonitorPage } from './views.js';

const IN_TYPES = ['EVENT_RECEIVED', 'EVENT_PROCESSED', 'EVENT_DUPLICATE', 'SESSION_INBOUND_SKIP', 'EVENT_FAILED'];
const OUT_TYPES = ['final_send_dispatched', 'composition_send_failed', 'OUTBOX_SENT', 'OUTBOX_DLQ', 'KILL_SEND_BLOCKED'];

function lastOf(types) {
  const rows = auditTail(120);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const e = rows[i];
    if (!types.includes(e.type)) continue;
    const pl = e.payload && typeof e.payload === 'object' ? e.payload : {};
    return {
      at: e.ts || null,
      type: e.type,
      result: pl.reason || pl.path || pl.state || 'recorded',
    };
  }
  return { at: null, type: null, result: 'none' };
}

export function sessionMonitorSnapshot() {
  const status = publicSessionStatus();
  const kill = peekState();
  return {
    ...status,
    mode: isLive() ? 'LIVE' : 'DEMO',
    testIdentity: maskedMeIdentity(),
    kill: kill.state || 'UNKNOWN',
    lastInbound: lastOf(IN_TYPES),
    lastOutbound: lastOf(OUT_TYPES),
  };
}

export function renderSessionMonitor({ showQr = false, refresh = false, qrSrc, csrf, retryUrl } = {}) {
  return sessionMonitorPage(sessionMonitorSnapshot(), { showQr, refresh, qrSrc, csrf, retryUrl });
}
