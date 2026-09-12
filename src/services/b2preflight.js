// ─────────────────────────────────────────────────────────────
//  B-2 LIVE TRANSPORT READINESS — READ-ONLY PREFLIGHT
//  Code/config inspection of the EXISTING Meta Cloud API path.
//  No Graph API calls. No QR/session adapter. No send.
//  A READY check is not live-delivery evidence. B-2 stays OPEN
//  until a real WABA run is recorded.
// ─────────────────────────────────────────────────────────────
import { config, isLive } from '../config.js';
import { claimEvent } from '../sentinel/idempotency.js';
import { createOutbox } from '../sentinel/outbox.js';
import * as numberFirewall from '../sentinel/numberFirewall.js';
import { peekState } from '../sentinel/killswitch.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { confirmPaidSale } from './customers.js';
import { catalog } from './catalog.js';

export const LIVE_DELIVERY = 'IMPLEMENTED BUT UNPROVEN';
export const QR_SESSION = 'NOT IMPLEMENTED';
export const CURRENT_TRANSPORT = 'Meta Cloud API';

const present = (v) => typeof v === 'string' && v.trim().length > 0;
const secretPresence = (v) => (present(v) ? 'set' : 'empty'); // never the value

function check(id, title, status, evidence) {
  return { id, title, status, evidence };
}

function webhookSignatureCheck(live) {
  const secretSet = present(config.appSecret);
  const masked = `META_APP_SECRET=${secretPresence(config.appSecret)} (value masked)`;
  if (secretSet) {
    return check(
      'webhook_signature',
      'Inbound webhook HMAC (x-hub-signature-256)',
      'READY',
      `${masked}; HMAC path present in src/routes/webhook.js. Not a live Meta signature proof.`,
    );
  }
  if (live) {
    return check(
      'webhook_signature',
      'Inbound webhook HMAC (x-hub-signature-256)',
      'BLOCKED',
      `${masked}; LIVE requires a nonempty secret (boot gate). Signature cannot be optional in production.`,
    );
  }
  return check(
    'webhook_signature',
    'Inbound webhook HMAC (x-hub-signature-256)',
    'UNKNOWN',
    `${masked}; DEMO may accept unsigned webhooks. Not evidence of production HMAC.`,
  );
}

function idempotencyCheck() {
  return check(
    'idempotency',
    'Inbound wamid idempotency (claimEvent)',
    'READY',
    `src/sentinel/idempotency.js present; claimEvent export is ${typeof claimEvent}. Live wamid replay not executed.`,
  );
}

function outboxCheck() {
  return check(
    'outbox',
    'Durable outbox (createOutbox)',
    'READY',
    `createOutbox export is ${typeof createOutbox}; code path present. No worker started, no live send.`,
  );
}

function numberFirewallCheck() {
  const ok = typeof numberFirewall.validateMonetaryReply === 'function';
  return check(
    'number_firewall',
    'DEBT-07 model-output number firewall',
    ok ? 'READY' : 'BLOCKED',
    ok
      ? 'src/sentinel/numberFirewall.js imported; validateMonetaryReply export present. No send executed.'
      : 'numberFirewall.js imported but validateMonetaryReply export missing.',
  );
}

function killSwitchCheck() {
  const peeked = peekState();
  return check(
    'kill_switch',
    'CAP-055 owner kill switch',
    'READY',
    `src/sentinel/killswitch.js imported; peekState().state=${peeked.state}. No stop/resume invoked.`,
  );
}

function cap008Check() {
  let ok = false;
  let evidence = 'src/routes/inbox.js unreadable';
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../routes/inbox.js');
    const src = fs.readFileSync(file, 'utf8');
    ok = src.includes('inboxRouter') && src.includes('confirm-paid') && src.includes('requireAuth');
    evidence = ok
      ? 'src/routes/inbox.js contains inboxRouter + confirm-paid + requireAuth (file inspect; no HTTP listen).'
      : 'src/routes/inbox.js missing expected CAP-008 markers.';
  } catch (e) {
    evidence = 'src/routes/inbox.js inspect failed: ' + String(e?.message || e).slice(0, 80);
  }
  return check('cap008_inbox', 'CAP-008 human inbox router', ok ? 'READY' : 'BLOCKED', evidence);
}

function paidConfirmCheck() {
  const ok = typeof confirmPaidSale === 'function';
  return check(
    'paid_confirm',
    'Staff confirm-paid (confirmPaidSale)',
    ok ? 'READY' : 'BLOCKED',
    ok
      ? 'confirmPaidSale export exists on src/services/customers.js. No sale written.'
      : 'confirmPaidSale export missing.',
  );
}

function catalogCheck() {
  const cat = catalog();
  if (cat?.corrupted) {
    return check(
      'catalog_authority',
      'Catalog authority (products.json)',
      'BLOCKED',
      `catalog().corrupted=true reason=${cat.reason || 'UNREADABLE_OR_BAD_SCHEMA'}. No fallback prices.`,
    );
  }
  const n = Array.isArray(cat?.products) ? cat.products.length : 0;
  return check(
    'catalog_authority',
    'Catalog authority (products.json)',
    'READY',
    `catalog() readable; corrupted=false; products=${n}. Read-only inspection.`,
  );
}

function qrTransportCheck() {
  return check(
    'qr_transport',
    'QR / session transport',
    'NOT_IMPLEMENTED',
    'CURRENT TRANSPORT = Meta Cloud API. QR/session is NOT IMPLEMENTED. This preflight does not add or probe a QR adapter.',
  );
}

function liveCredentialsCheck(live) {
  const token = `WHATSAPP_TOKEN=${secretPresence(config.whatsappToken)}`;
  const phone = `PHONE_NUMBER_ID=${secretPresence(config.phoneNumberId)}`;
  if (live) {
    return check(
      'live_credentials',
      'Live Cloud API credentials (isLive)',
      'READY',
      `${token}; ${phone} (values masked). isLive() true is not Graph API acceptance proof.`,
    );
  }
  return check(
    'live_credentials',
    'Live Cloud API credentials (isLive)',
    'BLOCKED',
    `${token}; ${phone} (values masked). isLive() false — DEMO. Live credentials BLOCKED.`,
  );
}

/**
 * Read-only preflight of the existing Meta Cloud API path.
 * Does not call Meta. Does not send. Does not claim live success.
 */
export function b2Preflight() {
  const live = isLive();
  return {
    current_transport: CURRENT_TRANSPORT,
    qr_session: QR_SESSION,
    live_delivery: LIVE_DELIVERY,
    is_live: live,
    checks: [
      webhookSignatureCheck(live),
      idempotencyCheck(),
      outboxCheck(),
      numberFirewallCheck(),
      killSwitchCheck(),
      cap008Check(),
      paidConfirmCheck(),
      catalogCheck(),
      qrTransportCheck(),
      liveCredentialsCheck(live),
    ],
  };
}
