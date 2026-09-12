// EMI / Installment Wizard — 3% monthly service charge (store policy)
import { formatPrice } from './catalog.js';

export const EMI_MONTHS = [3, 6, 9, 12];
export const EMI_MONTHLY_RATE = 0.03;

export function emiNumericSet(price, monthlyRate = EMI_MONTHLY_RATE) {
  const set = new Set();
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return set;
  set.add(Math.round(price));
  for (const m of EMI_MONTHS) {
    const t = price * (1 + monthlyRate * m);
    set.add(Math.round(t));
    set.add(Math.round(t / m));
  }
  return set;
}

export function emiPlanFor(price, months = 6, monthlyRate = EMI_MONTHLY_RATE) {
  const allowed = EMI_MONTHS;
  if (!allowed.includes(months)) months = 6;

  // Simple flat service-charge model (asli calc store policy ke mutabiq hogi)
  const total = price * (1 + monthlyRate * months);
  const monthly = Math.round(total / months);

  const table = allowed
    .map((m) => {
      const t = price * (1 + monthlyRate * m);
      return `  ${m === months ? '👉' : '•'} *${m} mahine:* ${formatPrice(Math.round(t / m))}/mahina (total ${formatPrice(Math.round(t))})`;
    })
    .join('\n');

  return `💳 *EMI Plan — ${formatPrice(price)} ke liye:*\n\n${table}\n\n📄 Phone lene ke liye sirf CNIC chahiye. Store par 10 minute ka kaam!\n*visit* likhein to timing aur pata mil jayega 📅`;
}
