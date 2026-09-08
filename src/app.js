// Testable app builder — index.js boot karta hai, tests import karte hain
import express from 'express';
import { config, isLive } from './config.js';
import { webhookRouter } from './routes/webhook.js';
import { inboxRouter } from './routes/inbox.js';

export function buildApp() {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));
  app.use('/inbox', express.urlencoded({ extended: false })); // inbox forms

  app.get('/', (_req, res) =>
    res.json({
      bot: 'NOOR 🌙 / Sentinel-gated',
      store: config.storeName,
      mode: isLive() ? 'LIVE (WhatsApp Cloud API)' : 'DEMO (keys set karein .env mein)',
      sentinel: 'phase-2A: verified-ingestion + idempotency + audit + outbox ACTIVE',
      status: 'running',
      time: new Date().toISOString(),
    })
  );

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(webhookRouter);
  app.use(inboxRouter);
  return app;
}
