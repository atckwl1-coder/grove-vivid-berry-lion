// ─────────────────────────────────────────────────────────────
//  VERIFIED EVENT INGESTION (Sentinel §12/§16)
//  Order of truth: SIGNATURE → IDEMPOTENCY → AUDIT → process → AUDIT
// ─────────────────────────────────────────────────────────────
import express from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { handleIncomingMessage } from '../services/brain.js';
import { claimEvent } from '../sentinel/idempotency.js';
import { audit } from '../sentinel/audit.js';
import { log } from '../utils/logger.js';

export const webhookRouter = express.Router();

// ─── Meta webhook verification (setup-time, ek dafa) ───
webhookRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.verifyToken) {
    audit('WEBHOOK_VERIFIED_BY_META', {});
    return res.status(200).send(challenge);
  }
  audit('WEBHOOK_VERIFY_REJECTED', {});
  return res.sendStatus(403);
});

// ─── Incoming events ───
webhookRouter.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Meta ko foran 200 — varna retry storm

  try {
    // GATE 1 — AUTHENTICITY (mandatory whenever appSecret is configured;
    // LIVE mode boot-gate guarantees it is configured)
    if (config.appSecret) {
      if (!req.rawBody || !validSignature(req)) {
        audit('WEBHOOK_FORGED', { hadHeader: Boolean(req.headers['x-hub-signature-256']) });
        log.warn('⛔ Forged/unsigned webhook rejected');
        return; // BLOCK — never process
      }
    } else {
      audit('WEBHOOK_UNSIGNED_ACCEPTED_DEMO', {}); // DEMO only — label stays honest
    }

    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const messages = value?.messages || [];
        const profileName = value?.contacts?.[0]?.profile?.name || '';

        for (const msg of messages) {
          const id = msg.id;

          // GATE 2 — IDEMPOTENCY: replayed deliveries die here
          if (id && !claimEvent(id)) {
            audit('EVENT_DUPLICATE', { id });
            continue;
          }

          // GATE 3 — AUDIT BEFORE PROCESS (§19)
          audit('EVENT_RECEIVED', { id, from: msg.from, type: msg.type });

          try {
            await handleIncomingMessage(msg, profileName);
            audit('EVENT_PROCESSED', { id });
          } catch (err) {
            // §27: failure is a first-class state — logged truthfully, never hidden
            audit('EVENT_FAILED', { id, error: String(err?.message || err) });
            log.error('Event processing failed:', err?.message || err);
          }
        }
      }
    }
  } catch (err) {
    audit('WEBHOOK_ERROR', { error: String(err?.message || err) });
    log.error('Webhook error:', err?.message || err);
  }
});

function validSignature(req) {
  try {
    const signature = req.headers['x-hub-signature-256'] || '';
    const expected =
      'sha256=' + crypto.createHmac('sha256', config.appSecret).update(req.rawBody).digest('hex');
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
