// ─────────────────────────────────────────────────────────────
//  SCHEDULER — subah ka owner brief + maintenance jobs
// ─────────────────────────────────────────────────────────────
import cron from 'node-cron';
import { config } from '../config.js';
import * as wa from '../services/whatsapp.js';
import { allCustomers, today } from '../services/customers.js';
import { catalog } from '../services/catalog.js';
import { sweepFollowUps } from '../services/followups.js';
import { log } from '../utils/logger.js';

export function startScheduler() {
  // 🌅 9:00 AM PKT (4:00 UTC) — Owner Morning Brief
  cron.schedule('0 4 * * *', async () => {
    const customers = allCustomers();
    const newToday = customers.filter((c) => c.lastSeen?.startsWith(today())).length;
    // V1-2 (CAP-003): corrupt catalog → honest line, never "sab theek" on missing data.
    const cat = catalog();
    const lowStock = cat.corrupted ? null : cat.products.filter((p) => p.stock <= 2);
    const lowStockLine = cat.corrupted
      ? '⚠️ CATALOG UNAVAILABLE — products.json check karein'
      : (lowStock.length ? lowStock.map((p) => `${p.name} (${p.stock})`).join(', ') : 'sab theek ✅');

    const brief =
      `☀️ *Assalam o Alaikum Boss! NOOR Morning Brief*\n\n` +
      `👥 Total customers: ${customers.length}\n` +
      `🆕 Kal active: ${newToday}\n` +
      `📦 Low stock alert: ${lowStockLine}\n` +
      `🛡️ Quality rating: UNAVAILABLE (Meta quality_rating is not wired — this is not a live signal)\n\nAaj ka din mubarak ho! 🚀`;

    log.info('Owner brief ready');
    if (config.ownerPhone) await wa.sendText(config.ownerPhone, brief).catch(() => {});
  });

  // 🛡️ Har ghante — quality rating check (live mode mein Meta API se)
  cron.schedule('0 * * * *', () => {
    // TODO(phase-1): GET /{phone_number_id} quality_rating → yellow/red par
    // campaigns auto-pause + owner ko alert
    log.info('Quality rating check skipped — Meta quality_rating not wired (UNAVAILABLE)');
  });

  // V1-4 (2026-09-10): post-purchase satisfaction follow-up sweep — every
  // 15 minutes. The follow-up itself fires at exactly sale+10d (the dueAt is
  // deterministic and file-persistent); the sweep interval only bounds
  // "approximately Day 10" (worst case: ≤15 min late). Scheduling + dispatch
  // are idempotent (existing claimEvent + status lifecycle) — repeated runs
  // can never duplicate a send.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await sweepFollowUps(); // async: a rejected send must resolve into a status, not a lost promise
    } catch (e) {
      log.error('Follow-up sweep failed:', e?.message || e);
    }
  });

  log.info('⏰ Scheduler started (owner brief 9AM PKT, quality check hourly, follow-up sweep 15min)');
}
