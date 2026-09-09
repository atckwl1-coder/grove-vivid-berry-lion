// ─────────────────────────────────────────────────────────────
//  FLOW ROUTER — menu, buttons, EMI, trade-in, visit-info (V1-0: no fake booking)
//  AI se pehle kaam karta hai: agar yahan handle ho gaya to AI ki zaroorat nahi
// ─────────────────────────────────────────────────────────────
import * as wa from '../services/whatsapp.js';
import { catalog, findProduct, formatPrice } from '../services/catalog.js';
import { emiPlanFor } from '../services/emi.js';
import { estimateTradeIn } from '../services/tradein.js';
import { updateCustomer } from '../services/customers.js';
import { escalate } from '../sentinel/conversations.js';

export async function routeFlow(from, rawText, msg, customer) {
  const text = rawText.toLowerCase().trim();

  // ── Main menu triggers ──
  if (/^(menu|hi|hello|salam|aoa|start)$/i.test(text)) {
    await wa.sendList(from, `Assalam o Alaikum${customer.name ? ' ' + customer.name : ''}! 🙌\n*OPPO Experience Store Khanewal* mein khush aamdeed.\n\nKya chahte hain aaj?`, '🔽 Menu kholein', [
      {
        title: 'Kharidari',
        rows: [
          { id: 'menu_phones', title: '📱 Phones & Aaj ki Prices', description: 'Poora OPPO catalog' },
          { id: 'menu_emi', title: '💳 EMI / Installments', description: '3-12 mahine ki asaan iqsaat' },
          { id: 'menu_tradein', title: '🔄 Purana Phone Exchange', description: 'Photo bhejein, fauran value' },
        ],
      },
      {
        title: 'Service',
        rows: [
          { id: 'menu_repair', title: '🛠️ Repair / Status', description: 'Repair info — staff se baat karein' },
          { id: 'menu_visit', title: '📅 Store Visit', description: 'Timing & location — staff se rabta' },
          { id: 'menu_staff', title: '👤 Staff se Baat', description: 'Insaani madad, 5 minute mein' },
        ],
      },
    ]);
    return true;
  }

  // ── Menu item selections ──
  if (text === 'menu_phones') {
    const list = catalog().products
      .map((p) => `📱 *${p.name}* (${p.variant})\n   💰 ${formatPrice(p.price)} — stock: ${p.stock}`)
      .join('\n\n');
    await wa.sendButtons(from, `*Aaj ke OPPO rates:* 🏷️\n\n${list}\n\nModel ka naam likh kar details lein (maslan "reno13")`, [
      { id: 'menu_emi', title: '💳 EMI dekhein' },
      { id: 'menu_tradein', title: '🔄 Exchange offer' },
      { id: 'menu_staff', title: '👤 Staff se baat' },
    ]);
    return true;
  }

  if (text === 'menu_staff') {
    // CAP-008: REAL escalation into staff inbox — the old line was an unmeasurable
    // "5 minute" promise and owner-alert-only fallback. Deleted per Human Fallback Rule.
    // If already queued, escalate() sends NOTHING (no double-ack) — and neither do we.
    await escalate(from, 'CUSTOMER_REQUESTED_HUMAN', {});
    updateCustomer(from, { state: 'HUMAN' });
    return true;
  }

  if (text === 'menu_visit') {
    // V1-0 TRUTH CUT (2026-09-09): booking backend does NOT exist — "Token mil jayega"
    // was a phantom promise. Truth: no slot/token from WhatsApp; real path = staff.
    // (state 'BOOKING' no longer set — nothing consumes it; it was a false signal.)
    await wa.sendText(from,
      `📅 *Store Visit*\n` +
      `⚠️ WhatsApp se visit appointment book karna abhi possible nahi — hum aapke liye slot confirm nahi kar sakte. 🙏\n` +
      `🕙 Timing: ${catalog().policies.timing}\n` +
      `📍 Khanewal city center\n` +
      `💬 *staff* likhein — team aapki madad kare gi.`);
    return true;
  }

  // ── EMI flow: "emi reno13" ya "emi 85000 6" ──
  if (text.startsWith('emi') || text === 'menu_emi') {
    const parts = text.split(/\s+/);
    let price = Number(parts[1]) || 0;
    const months = Number(parts[2]) || 6;
    if (!price && parts[1]) {
      const p = findProduct(parts[1]);
      if (p) price = p.price;
    }
    if (!price) {
      await wa.sendText(from, '💳 *EMI plan nikalna aasan hai!*\nModel likhein: "emi reno13"\nYa amount + mahine: "emi 85000 6"');
      return true;
    }
    await wa.sendText(from, emiPlanFor(price, months));
    return true;
  }

  // ── Trade-in flow: "trade a57 good" ──
  if (text.startsWith('trade') || text === 'menu_tradein') {
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      updateCustomer(from, { state: 'TRADEIN' });
      await wa.sendText(from, `🔄 *Purana phone exchange — 3 sawal, fauran value!*\n\nLikhain: "trade <model> <condition>"\nMaslan: *trade a57 good*\n\nCondition: good / average / poor\n📸 Ya apne purane phone ki photo bhej dein — main khud condition check kar lunga!`);
      return true;
    }
    const estimate = estimateTradeIn(parts[1], parts[2]);
    await wa.sendButtons(from, estimate.text, [
      { id: 'menu_phones', title: '📱 Naya phone choose' },
      { id: 'menu_visit', title: '📅 Timing & pata' },
      { id: 'menu_staff', title: '👤 Staff se baat' },
    ]);
    return true;
  }

  // ── Reserve intent: V1-0 TRUTH CUT (2026-09-09) ──
  // Online reservation DOES NOT exist (no backend, no persistence, no hold).
  // Old "✅ RESERVED! / Token NK-… / 24 ghante aapke naam par" was a phantom
  // (registry CAP-006: REDESIGN_REQUIRED — truth violation). No token, no hold,
  // no slot, no watch promise — only catalog truth + the real human path.
  // Capability remains NOT IMPLEMENTED by design: V1-0 removes the lie, it does
  // not build the reservation feature (no persistence/slots/token semantics).
  if (text.startsWith('reserve')) {
    // Empty query guard: findProduct('') matches the FIRST product (includes('')
    // is true for all names) — quoting a3x on a bare "reserve" would be a false
    // attribution, so only a real, non-empty model token may resolve a product.
    const q = text.split(/\s+/)[1] || '';
    const p = q ? findProduct(q) : null;
    const info = p
      ? `📱 *${p.name}* (${p.variant}) — aaj ki price: *${formatPrice(p.price)}*\n📦 Stock abhi: ${p.stock} pieces\n\n`
      : '';
    await wa.sendText(from,
      info +
      `⚠️ WhatsApp se online reservation abhi available nahi — hum phone aapke naam hold nahi kar sakte. 🙏\n` +
      `🏪 Seedha store par aayen, ya *staff* likh kar team se baat karein.\n` +
      `🕙 ${catalog().policies.timing}`);
    return true;
  }

  // ── Location ──
  if (text.includes('location') || text.includes('address') || text.includes('pata')) {
    await wa.sendText(from, '📍 *OPPO Experience Store Khanewal*\nMain Bazaar, Khanewal city center\n\n🕙 ' + catalog().policies.timing + '\n\nGoogle Maps: https://maps.google.com/?q=Khanewal (demo link — asli pin yahan lagega)');
    return true;
  }

  return false; // is point par AI brain sambhalta hai
}
