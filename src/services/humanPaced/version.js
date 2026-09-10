// ─────────────────────────────────────────────────────────────
//  CONVERSATION VERSION (Human-Paced Safety Layer, 2026-09-11) — §8
//  Stale-response protection: the observable state a reply was generated
//  against, re-read at composition checkpoints and before dispatch.
//
//  READ-ONLY over existing state (no foundation change):
//   • customer.lastSeen  — bumped by touchCustomer on EVERY inbound
//                          (a new customer message = version change)
//   • conv.state/updatedAt/history/unread — bumped by every CAP-008
//                          transition (takeover, claim, close, reopen)
//   • customer.optedOut  — the explicit do-not-contact state (CAP-002)
//  Any change ⇒ the in-flight composition is stale ⇒ cancelled, never sent.
// ─────────────────────────────────────────────────────────────
import { getConversation } from '../../sentinel/conversations.js';
import { getCustomer } from '../customers.js';

export function conversationVersion(phone) {
  const conv = getConversation(phone);
  const c = getCustomer(phone);
  return {
    state: conv?.state ?? 'NONE',
    updatedAt: conv?.updatedAt ?? null,
    historyLen: Array.isArray(conv?.history) ? conv.history.length : 0,
    unread: conv?.unread ?? 0,
    lastSeen: c?.lastSeen ?? null,
    optedOut: c?.optedOut === true,
  };
}

export function sameVersion(a, b) {
  return Boolean(a && b)
    && a.state === b.state
    && a.updatedAt === b.updatedAt
    && a.historyLen === b.historyLen
    && a.unread === b.unread
    && a.lastSeen === b.lastSeen
    && a.optedOut === b.optedOut;
}
