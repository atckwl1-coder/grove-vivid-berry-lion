// ─────────────────────────────────────────────────────────────
//  🚀 NOOR / Sentinel — Entry point (Phase 2A hardened)
//  Boot order: SAFETY GATE → audit init → DB → outbox(recover+start) → HTTP
// ─────────────────────────────────────────────────────────────
import { config, isLive, assertBootSafety } from './config.js';
import { buildApp } from './app.js';
import { loadDb } from './services/customers.js';
import { initAudit, audit } from './sentinel/audit.js';
import { initIdempotency } from './sentinel/idempotency.js';
import { createOutbox } from './sentinel/outbox.js';
import { initOutbox, deliverToMeta, demoDeliver } from './services/whatsapp.js';
import { resolveTransport, requestedTransportId } from './sentinel/transport.js';
import { createSessionAdapter } from './sentinel/session/adapter.js';
import { messagingWindowGuard } from './sentinel/gates.js';
import { startScheduler } from './workers/scheduler.js';
import { log } from './utils/logger.js';
import { seedStaffIfMissing, assertStaffSafety } from './sentinel/auth.js';
import * as conversations from './sentinel/conversations.js';
import { logOutbound } from './services/customers.js';
import { noteOutboxTerminal } from './services/followups.js';
import * as waSvc from './services/whatsapp.js';
import * as killswitch from './sentinel/killswitch.js';

// ⛔ GATE 0 — boot safety: LIVE mode ke liye app secret lazmi hai
try {
  assertBootSafety();
} catch (e) {
  console.error('⛔ ' + e.message);
  process.exit(1);
}

// Foundation subsystems
initAudit();
initIdempotency();
try {
  loadDb();
} catch (e) {
  console.error('⛔ ' + e.message);
  process.exit(1);
}
killswitch.initKill(); // CAP-055: global autonomy gate — state restored/genesis before anything can send

// CAP-008 gates: LIVE → staff creds + session secret lazmi; DEMO → labeled demo seed
try {
  if (isLive()) assertStaffSafety();
  seedStaffIfMissing();
} catch (e) {
  console.error('⛔ ' + e.message);
  process.exit(1);
}

// Durable outbound dispatcher — inject provider + policy guard + kill gate
const sessionAdapter = createSessionAdapter({ authDir: config.waSessionDir, auditFn: audit });
const transport = resolveTransport({
  live: isLive(),
  deliverToMeta,
  demoDeliver,
  sessionSendFn: sessionAdapter.sendFn,
});
const outbox = createOutbox({
  dir: config.outboxDir,
  sendFn: transport.sendFn,
  windowGuard: messagingWindowGuard,
  autonomyGuard: (job) => (killswitch.isAutonomousJob(job) ? killswitch.gateForSend(job.payload?.to, { source: job.meta?.source }) : { ok: true }),
  auditFn: audit,
  onTerminal: noteOutboxTerminal,
  pollMs: config.outboxPollMs,
  retry: config.retry,
});
initOutbox(outbox);

// CAP-055 wiring: enqueue-layer brake + STOP/RESUME → outbox hold/release
waSvc.setKillGate((toPhone, meta) => killswitch.gateForSend(toPhone, meta));
killswitch.onKillStop(() => outbox.holdAutonomous(killswitch.isAutonomousJob));
killswitch.onKillResume(() => outbox.releaseHeld());
outbox.recover(); // §17: crash-interrupted jobs — honestly re-queued as UNCERTAIN
outbox.start();

if (transport.id === 'session') {
  sessionAdapter.start().catch((err) => {
    log.error('session adapter start failed:', err?.message || err);
  });
}

// ── CAP-008 wiring: suppression chokepoint + human-send path + SLA clock ──
waSvc.setSendGuard(conversations.authorizeOutbound); // §5 wall 2 — LLM/UI cannot bypass
waSvc.setMessageLogger(logOutbound);                 // §6 context: [BOT]/[STAFF•id] tags
// Escalation ack sender: the ONLY legal AI-tagged send during ESCALATION_PENDING
conversations.setEscalationAckSender((to, ackText) =>
  waSvc.sendText(to, ackText, { source: 'AI_SYSTEM_ACK' }));
conversations.setOwnerAlertFn((info) => {
  if (!config.ownerPhone) return;
  waSvc.sendText(config.ownerPhone,
    `🚨 *SLA BREACH*\nConversation: ${info.conversation}\nReason: ${info.reason}\nState: ${info.state}\nInbox kholein aur claim karein.`,
    { source: 'SYSTEM' }).catch(() => {});
});
setInterval(() => conversations.slaSweep(), 60_000).unref(); // §8 measured SLA

const app = buildApp();

app.listen(config.port, '0.0.0.0', () => {
  audit('BOOT', {
    mode: isLive() ? 'LIVE' : 'DEMO',
    transport: transport.id,
    requestedTransport: requestedTransportId(),
    port: Number(config.port),
    sentinel: 'phase2a',
    signatureEnforcement: Boolean(config.appSecret),
  });
  log.info(`🌙 NOOR is awake on port ${config.port} — mode: ${isLive() ? 'LIVE' : 'DEMO'} — transport: ${transport.id} — Sentinel 2A ACTIVE`);
  log.info(`🛡️  Signature enforcement: ${config.appSecret ? 'ON' : 'DEMO-OFF'} · Audit: ${config.auditFile}`);
  startScheduler();
});
