// Sequential CRM observe: profile first, then qualification.
// Each re-reads the customer so stateData keys do not clobber.
// Never sends. Never marks paid. Never invents prices.
import { refreshProfile } from './profile.js';
import { refreshQualification } from './qualification.js';

export function observeCustomer(phone, text) {
  try { refreshProfile(phone, text); } catch { /* observe must not break inbound */ }
  try { refreshQualification(phone); } catch { /* same */ }
}
