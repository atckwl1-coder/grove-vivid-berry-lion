// Outbound policy gates — LIVE mode mein 24h customer-service window enforcement
// (Meta rule: free-form replies sirf customer ke last message ke 24h ke andar)
import { isLive } from '../config.js';
import { getCustomer } from '../services/customers.js';

export function messagingWindowGuard(payload) {
  if (!isLive()) return { ok: true }; // DEMO: not evidence of production — documented
  if (payload?.type === 'template') return { ok: true }; // templates window ke bahar allowed
  const phone = String(payload?.to || '');
  const c = getCustomer(phone);
  const last = c?.lastSeen ? Date.parse(c.lastSeen) : 0;
  const open = Date.now() - last < 24 * 3600 * 1000;
  return open ? { ok: true } : { ok: false, reason: 'customer_window_closed' };
}
