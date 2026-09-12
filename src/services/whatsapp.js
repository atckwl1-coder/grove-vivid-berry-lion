// ─────────────────────────────────────────────────────────────
//  WHATSAPP CLIENT — Phase 2A: SAB kuch durable outbox se guzarta hai.
//  Koi bhi send() fire-and-forget nahi — queued, audited, retried.
// ─────────────────────────────────────────────────────────────
import axios from 'axios';
import { config, isLive } from '../config.js';
import { markSessionUnavailable } from './humanPaced/sessionHealth.js';
import { log } from '../utils/logger.js';
import { redact } from '../sentinel/audit.js';
import * as firewall from '../sentinel/firewall.js'; // P2: static wiring — no config can disable the boundary

const apiUrl = () => `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
const headers = () => ({
  Authorization: `Bearer ${config.whatsappToken}`,
  'Content-Type': 'application/json',
});

// Outbox injected at boot (index.js) or by tests — no circular imports
let outbox = null;
export function initOutbox(instance) {
  outbox = instance;
}

// Real provider call — SIRF outbox worker use karta hai (LIVE mode)
//
// Human-Paced Safety Layer (§15): a CREDENTIAL rejection (401/403) is a fatal
// session condition → mark the session unavailable (autonomous composing then
// fails closed at its dispatch boundary until the operator re-authenticates).
// Transient errors (5xx/429/network/timeout) are NOT fatal — the EXISTING
// bounded outbox retry policy handles them unchanged. No new retry/reconnect
// logic is introduced here (this adapter is stateless per send).
export function classifyProviderError(err) {
  const status = err?.response?.status ?? null;
  const fatal = status === 401 || status === 403;
  return { fatal, status };
}

export async function deliverToMeta(payload) {
  try {
    const { data } = await axios.post(apiUrl(), payload, { headers: headers(), timeout: 15000 });
    return data;
  } catch (err) {
    if (classifyProviderError(err).fatal) markSessionUnavailable(`meta_auth_rejected_${err.response.status}`);
    throw err;
  }
}

// Demo provider — console print RE-DACTED (PII boundary, 2A.1).
// DEMO output par bhi poora phone number nahi jata. (not production evidence)
export function demoDeliver(payload) {
  console.log('\n📤 [DEMO — outbox job delivered]');
  console.dir(JSON.parse(redact(JSON.stringify(payload))), { depth: null });
  return { demo: true };
}

// ── Chokepoint hooks ─────────────────────────────────────────────────
// P2 CHANGE-FREEZE NOTE: setSendGuard/setKillGate are DEPRECATED compatibility
// shims (stored, invoked only as EXTRA guards AFTER an ALLOW). The real boundary
// is firewall.evaluate() — statically called below; nothing can bypass it by config.
let sendGuard = null;
export function setSendGuard(fn) { sendGuard = fn; }
let messageLogger = null;
export function setMessageLogger(fn) { messageLogger = fn; }
let killGate = null;
export function setKillGate(fn) { killGate = fn; } // kept for CAP-055 wiring compat; firewall does the kill check authoritatively

// ── The ONLY send path in the whole system ──
//
// P2 FIREWALL is the action-class chokepoint (kill/identity/authz/
// evidence/policy/idempotency). It does NOT inspect message bodies
// or monetary amounts.
//
// DEBT-07 number firewall is NOT here and is NOT in outbox.enqueue.
// Putting validateMonetaryReply on every AI send would reject
// legitimate deterministic copy (customer-stated EMI principals
// such as "emi 85000 6", which are not catalog prices).
//
// Model-generated customer-facing text must enter via
// brain.deliverModelOutput / pacedBrainSend, which run the
// validator and tag origin=MODEL_OUTPUT + monetaryValidated.
// A caller that sendTexts LLM/vision copy without that origin is
// a contract violation this transport cannot distinguish from
// catalog/EMI/negotiation copy. That limitation is accepted
// rather than coupling content validation into P2/outbox.
async function send(payload, meta = { source: 'AI' }) {
  if (!outbox) throw new Error('Sentinel: outbound dispatcher not initialized');
  if (meta.origin === 'MODEL_OUTPUT' && meta.monetaryValidated !== true) {
    const e = new Error('MODEL_OUTPUT_NOT_VALIDATED');
    e.code = 'MODEL_OUTPUT_NOT_VALIDATED';
    throw e;
  }
  // ▓▓ P2 FIREWALL — every send evaluates HERE, before anything is queued ▓▓
  const decision = firewall.evaluate({
    class: meta.class,
    source: meta.source,
    toPhone: payload?.to,
    tenant: meta.tenant,
    actor: meta.actor || (meta.staffId ? { staffId: meta.staffId, role: meta.role } : undefined),
    actionId: meta.actionId,
    evidence: meta.evidence,
  });
  if (decision.decision !== 'ALLOW') {
    const e = new Error(decision.reason);
    e.code = decision.reason;
    e.firewall = decision;
    throw e;
  }
  for (const extra of [killGate, sendGuard]) { // post-ALLOW defensive shims (legacy wiring)
    if (extra) {
      const g = extra(payload?.to, meta);
      if (!g.ok) { const e = new Error(g.reason || 'SEND_BLOCKED_BY_POLICY'); e.code = g.reason || 'SEND_BLOCKED_BY_POLICY'; throw e; }
    }
  }
  const job = outbox.enqueue(payload, { ...meta, firewall: { decision: decision.decision, reason: decision.reason, traceId: decision.traceId } });
  if (messageLogger && payload?.type === 'text') {
    try { messageLogger(payload.to, payload.text?.body, meta); } catch { /* logger must never break send path */ }
  }
  return job;
}

// Staff reply path (CAP-008 §7): same pipe, explicit HUMAN source tag.
export const enqueueAsHuman = (to, body, meta) =>
  send({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }, { ...meta, source: 'HUMAN' });

export const sendText = (to, body, meta) =>
  send({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }, meta);

export const sendButtons = (to, body, buttons) =>
  send({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b, i) => ({
          type: 'reply',
          reply: { id: b.id || `btn_${i}`, title: b.title.slice(0, 20) },
        })),
      },
    },
  });

export const sendList = (to, body, buttonText, sections) =>
  send({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: { type: 'list', body: { text: body }, action: { button: buttonText, sections } },
  });

export const sendImage = (to, link, caption = '') =>
  send({ messaging_product: 'whatsapp', to, type: 'image', image: { link, caption } });

export const sendTemplate = (to, name, languageCode = 'ur', components = []) =>
  send({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name, language: { code: languageCode }, components },
  });

export async function downloadMedia(mediaId) {
  if (!isLive()) return null;
  const { data } = await axios.get(`https://graph.facebook.com/${config.graphVersion}/${mediaId}`, { headers: headers() });
  const file = await axios.get(data.url, { headers: headers(), responseType: 'arraybuffer' });
  return file.data;
}

// Read receipts: low-risk, Meta-idempotent side effect — inline is acceptable.
// Documented gap: not outboxed (loss = harmless blue-tick miss).
export const markRead = (messageId) => {
  if (!isLive()) return;
  axios
    .post(apiUrl(), { messaging_product: 'whatsapp', status: 'read', message_id: messageId }, { headers: headers() })
    .catch(() => {});
};

// ── Typing indicator (Meta Cloud API — SUPPORTED capability, official docs
//    "Typing indicators" updated 2026-06-17; verified against the actual
//    session technology 2026-09-11 — VR-2026-09-11-02) ──
// Rides the SAME messages endpoint the adapter already uses (same token,
// same phone number ID): status:read + typing_indicator. It targets the
// 1-to-1 conversation of the triggering inbound message (message_id from the
// messages webhook). Platform semantics: the indicator is dismissed when a
// response is sent OR after 25 seconds (whichever comes first) — there is NO
// explicit stop call, and none is invented. Same documented class as
// markRead: a low-risk, Meta-idempotent presence side effect — no content,
// no recipient parameter — inline, best-effort, not outboxed, and never
// blocking or bypassing the message send path (firewall → outbox unchanged).
export const typingIndicatorPayload = (messageId) => ({
  messaging_product: 'whatsapp',
  status: 'read',
  message_id: messageId,
  typing_indicator: { type: 'text' },
});

export async function startTypingPresence(_phone, inboundMessageId) {
  if (!isLive() || !inboundMessageId) return null; // DEMO: no network, ever
  try {
    const { data } = await axios.post(apiUrl(), typingIndicatorPayload(inboundMessageId), { headers: headers(), timeout: 15000 });
    return data;
  } catch (err) {
    // Same token as message delivery: a credential rejection is the same
    // fatal session condition (fail-closed for autonomous composing).
    if (classifyProviderError(err).fatal) markSessionUnavailable(`meta_typing_auth_rejected_${err.response.status}`);
    throw err;
  }
}
