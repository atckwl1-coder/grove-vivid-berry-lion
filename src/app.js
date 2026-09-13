// Testable app builder — index.js boot karta hai, tests import karte hain
import express from 'express';
import { config, isLive } from './config.js';
import { webhookRouter } from './routes/webhook.js';
import { inboxRouter } from './routes/inbox.js';
import { renderSessionMonitor } from './inbox/sessionMonitor.js';
import { getSessionRuntime, publicSessionStatus } from './sentinel/session/runtime.js';

export function buildApp() {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));
  app.use('/inbox', express.urlencoded({ extended: false })); // inbox forms

  app.get('/', (_req, res) => {
    if (process.env.SENTINEL_PREVIEW_MONITOR === '1') {
      res.setHeader('Cache-Control', 'no-store');
      return res.type('html').send(renderSessionMonitor({ showQr: true, refresh: true, qrSrc: '/session-qr.png' }));
    }
    return res.json({
      bot: 'NOOR 🌙 / Sentinel-gated',
      store: config.storeName,
      mode: isLive() ? 'LIVE (WhatsApp Cloud API)' : 'DEMO (keys set karein .env mein)',
      sentinel: 'phase-2A: verified-ingestion + idempotency + audit + outbox ACTIVE',
      status: 'running',
      time: new Date().toISOString(),
    });
  });

  // Preview-only PNG. Env-gated. Never logs the payload. Not a JSON API.
  app.get('/session-qr.png', async (_req, res) => {
    if (process.env.SENTINEL_PREVIEW_MONITOR !== '1') return res.status(404).end();
    const adapter = getSessionRuntime().adapter;
    if (!adapter || typeof adapter.takeQr !== 'function') return res.status(404).send('NO_QR');
    let payload;
    try {
      payload = adapter.takeQr({ role: 'OWNER' });
    } catch {
      return res.status(404).send('NO_QR');
    }
    if (!payload) return res.status(404).send('NO_QR');
    try {
      const QR = await import('qrcode');
      const png = await QR.toBuffer(payload, { type: 'png', margin: 2, width: 320 });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.type('png').send(png);
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).type('text').send('QR_RENDER_UNAVAILABLE');
    }
  });

  app.get('/session-status.json', (_req, res) => {
    if (process.env.SENTINEL_PREVIEW_MONITOR !== '1') return res.status(404).end();
    const snap = publicSessionStatus();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      state: snap.state,
      qrAvailable: Boolean(snap.qrAvailable),
      qrSeq: snap.qrSeq || 0,
      qrPhase: snap.qrPhase || 'NONE',
      pairingHold: Boolean(snap.pairingHold),
      catchup: snap.catchup || 'PENDING',
      receivedPendingNotifications: Boolean(snap.receivedPendingNotifications),
      creds: Boolean(snap.creds),
      transport: snap.transport,
    });
  });

  app.post('/session-retry', async (_req, res) => {
    if (process.env.SENTINEL_PREVIEW_MONITOR !== '1') return res.status(404).end();
    const adapter = getSessionRuntime().adapter;
    if (!adapter || typeof adapter.retryPairing !== 'function') return res.status(409).send('NO_ADAPTER');
    try {
      await adapter.retryPairing({ role: 'OWNER' });
    } catch (e) {
      return res.status(e.code === 'OWNER_ONLY' ? 403 : 500).type('text').send(String(e.code || e.message || 'RETRY_FAILED').slice(0, 80));
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(303, '/');
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(webhookRouter);
  app.use(inboxRouter);
  return app;
}
