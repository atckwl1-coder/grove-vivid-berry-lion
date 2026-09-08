// ─────────────────────────────────────────────────────────────
//  WHATSAPP CLIENT — Phase 2A: SAB kuch durable outbox se guzarta hai.
//  Koi bhi send() fire-and-forget nahi — queued, audited, retried.
// ─────────────────────────────────────────────────────────────
import axios from 'axios';
import { config, isLive } from '../config.js';
import { log } from '../utils/logger.js';
import { redact } from '../sentinel/audit.js';

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
export async function deliverToMeta(payload) {
  const { data } = await axios.post(apiUrl(), payload, { headers: headers(), timeout: 15000 });
  return data;
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
async function send(payload, meta = { source: 'AI' }) {
  if (!outbox) throw new Error('Sentinel: outbound dispatcher not initialized');
  if (killGate) {
    const g = killGate(payload?.to, meta);
    if (!g.ok) { const e = new Error(g.reason); e.code = g.reason; throw e; }
  }
  if (sendGuard) {
    const g = sendGuard(payload?.to, meta);
    if (!g.ok) {
      const e = new Error(g.reason || 'SEND_BLOCKED_BY_POLICY');
      e.code = g.reason || 'SEND_BLOCKED_BY_POLICY';
      throw e;
    }
  }
  const job = outbox.enqueue(payload, meta);
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
