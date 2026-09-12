// ─────────────────────────────────────────────────────────────
//  V1-6 POST-PURCHASE SETUP HELP (copy only)
//  Honest first-run setup. No PTA/OPPO warranty API. No extra
//  scheduled follow-up (care must not become spam). Returns
//  text — never sends, never escalates. Router/LEAD may escalate
//  if isCareIssueIntent is true; this module only recommends
//  the *staff* path in copy.
// ─────────────────────────────────────────────────────────────
import { findProduct, approvedBenefitsLine, isCatalogCorrupted } from './catalog.js';

const WARRANTY_LINE =
  'Warranty check store par staff ke through — bot PTA/OPPO API query nahi karta';

const DAY10_LINE =
  'Day-10 care tabhi jab staff paid confirm kare — ye message scheduled nahi';

const SETUP_RE =
  /\b(setup|setting|settings|kaise\s+chalaye|kaise\s+chalu|kaise\s+start|google\s+account|gmail\s+account|sim\s+lagao|sim\s+laga|sim\s+dal|pehli\s+dafa|pehli\s+baar|first\s+run|account\s+banao|software\s+update|update\s+kaise|onboarding)\b/i;

const ISSUE_RE =
  /\b(masla|problem|issue|kharab|garam|heat|hang|freeze|friz|fault|toot|crack|defect|complaint|repair|broken|speaker|mic|display\s+kharab|battery\s+drain|nahi\s+chal\s+raha|nahi\s+ho\s+raha|restart|reboot)\b/i;

const STAFF_ISSUE_TEXT =
  'Ji, ye masla bot resolve nahi kar sakta. *staff* likhein — team aapki madad kare gi. Bot is path par escalate nahi karta.';

export function isSetupHelpIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return SETUP_RE.test(t);
}

export function isCareIssueIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isSetupHelpIntent(t) && !ISSUE_RE.test(t)) return false;
  return ISSUE_RE.test(t);
}

/**
 * Staff-path copy for a care issue. Does not escalate (router/LEAD does).
 */
export function composeIssueHelp() {
  return STAFF_ISSUE_TEXT;
}

/**
 * Honest first-run setup copy.
 * @param {string|null} productId catalog id or null for generic help
 */
export function composeSetupHelp(productId = null) {
  const lines = [
    '*Pehli dafa setup*',
    '1. Phone band karke SIM lagayein, phir on karein.',
    '2. Google account se sign in karein — aapke apne account par.',
    '3. Settings → software update check karein. Jo update device dikhaye, wahi follow karein — bot koi version number invent nahi karta.',
  ];

  if (!isCatalogCorrupted() && productId) {
    const p = findProduct(String(productId));
    if (p) {
      const claims = approvedBenefitsLine(p);
      if (claims) {
        lines.push('');
        lines.push(`📱 *${p.name}* — catalog-approved: ${claims}`);
      } else {
        lines.push('');
        lines.push(`📱 *${p.name}* — is model par owner-approved extra claims catalog mein nahi.`);
      }
    }
  }

  lines.push('');
  lines.push(WARRANTY_LINE);
  lines.push(DAY10_LINE);
  return lines.join('\n');
}
