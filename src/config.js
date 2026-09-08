import 'dotenv/config';

export const config = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.META_VERIFY_TOKEN || 'noor-verify-123',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  phoneNumberId: process.env.PHONE_NUMBER_ID || '',
  appSecret: process.env.META_APP_SECRET || '',
  graphVersion: process.env.GRAPH_API_VERSION || 'v21.0',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiBase: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
  storeName: process.env.STORE_NAME || 'OPPO Experience Store Khanewal',
  ownerPhone: process.env.OWNER_PHONE || '',
  dbFile: process.env.DB_FILE || './data/noor-db.json',

  // ── Sentinel Phase-2A ──
  auditFile: process.env.AUDIT_FILE || './data/audit.jsonl',
  idemDir: process.env.IDEM_DIR || './data/idempotency',
  outboxDir: process.env.OUTBOX_DIR || './data/outbox',
  redactPii: (process.env.REDACT_PII || 'true') !== 'false',
  outboxPollMs: Number(process.env.OUTBOX_POLL_MS || 2000),
  // ── CAP-008 Human Inbox ──
  tenantId: process.env.TENANT_ID || 'khanewal-demo',
  staffFile: process.env.STAFF_FILE || './data/staff.json',
  sessionsDir: process.env.SESSIONS_DIR || './data/sessions',
  convDir: process.env.CONV_DIR || './data/conversations',
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 12 * 3600 * 1000),
  slaMinutesInHours: Number(process.env.SLA_MINUTES_IN_HOURS || 5),
  insecureDemoAuth: !(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID), // DEMO seeding only
  killFile: process.env.KILL_FILE || './data/killswitch.json',
  retry: {
    maxAttempts: Number(process.env.RETRY_MAX || 5),
    baseMs: Number(process.env.RETRY_BASE_MS || 1500),
    maxMs: Number(process.env.RETRY_MAX_MS || 30000),
  },
};

export const isLive = () => Boolean(config.whatsappToken && config.phoneNumberId);

// ⛔ SENTINEL BOOT GATE: LIVE without appSecret = refuse to start.
// Signatures aren't optional in production. (§5, §37)
export function assertBootSafety(cfg = { live: isLive(), appSecret: config.appSecret }) {
  if (cfg.live && !cfg.appSecret) {
    throw new Error(
      'SENTINEL BOOT REFUSAL: LIVE mode requires META_APP_SECRET. Webhook authenticity cannot be optional in production.'
    );
  }
}
