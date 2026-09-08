// ─────────────────────────────────────────────────────────────
//  🛡️ ANTI-BAN GOVERNOR — NOOR ka sab se ehem module
//  Koi bhi MARKETING message is ki ijazat ke baghair QA nahi hoti.
//  Meta quality rating hamesha GREEN rakhna isi ka kaam hai.
// ─────────────────────────────────────────────────────────────
import { getCustomer, bumpMarketingCount, updateCustomer } from './customers.js';
import { log } from '../utils/logger.js';

const QUIET_START = 21; // raat 9 baje (PKT)
const QUIET_END = 9;    // subah 9 baje
const DAILY_MARKETING_CAP = 1;   // 1 customer ko din mein sirf 1 promo (Meta cap ~2 across ALL brands)
const MIN_ENGAGEMENT = 15;       // is se kam interest = message mat bhejo

/**
 * Kya is customer ko abhi marketing message bhejna chahiye?
 * @returns {{ok: boolean, reason: string}}
 */
export function canSendMarketing(phone) {
  const c = getCustomer(phone);

  if (!c) return { ok: false, reason: 'customer-unknown' };
  if (c.optedOut) return { ok: false, reason: 'opted-out' };
  if (!c.optedIn) return { ok: false, reason: 'no-optin' };
  if (isQuietHour()) return { ok: false, reason: 'quiet-hours' };
  if (c.marketingToday?.count >= DAILY_MARKETING_CAP) return { ok: false, reason: 'daily-cap' };
  if (c.engagement < MIN_ENGAGEMENT) return { ok: false, reason: 'low-engagement' };

  return { ok: true, reason: 'approved' };
}

// Bulk campaign sender — Governor se guzar kar hi bhejta hai
export async function sendCampaign(phones, sendFn) {
  const results = { sent: 0, skipped: {}, blocked: 0 };
  for (const phone of phones) {
    const check = canSendMarketing(phone);
    if (!check.ok) {
      results.skipped[check.reason] = (results.skipped[check.reason] || 0) + 1;
      results.blocked++;
      continue;
    }
    await sendFn(phone);
    bumpMarketingCount(phone);
    results.sent++;
    await sleep(1200); // pacing: 1 msg/sec se kam — spikes = ban risk
  }
  log.info(`🛡️ Campaign done: ${results.sent} sent, ${results.blocked} protected-skipped`, results.skipped);
  return results;
}

// PKT quiet hours (Asia/Karachi = UTC+5)
export function isQuietHour() {
  const pktHour = (new Date().getUTCHours() + 5) % 24;
  return pktHour >= QUIET_START || pktHour < QUIET_END;
}

// Warm-up pacing helper: naye number ke liye daily limit
export function warmupDailyLimit(accountAgeDays) {
  if (accountAgeDays <= 7) return 50;
  if (accountAgeDays <= 14) return 150;
  if (accountAgeDays <= 21) return 500;
  return Infinity; // tier ke mutabiq
}

// Angry-user protection: complaint aaye to marketing band
export function protectAfterComplaint(phone) {
  updateCustomer(phone, { engagement: 0 });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
