// ─────────────────────────────────────────────────────────────
//  FLOW ROUTER — menu, buttons, EMI, trade-in, reservation
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
          { id: 'menu_repair', title: '🛠️ Repair / Status', description: 'Phone doctor + slot booking' },
          { id: 'menu_visit', title: '📅 Store Visit Book Karein', description: 'Token lein, line mein na lagein' },
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
    updateCustomer(from, { state: 'BOOKING' });
    await wa.sendText(from, `📅 *Visit booking:*\nKal kaunsa waqt aapko suit karta hai? (maslan "kal 5 baje")\n\n🎟️ Token mil jayega — store par wait nahi karna parega!\n\n📍 Location: Khanewal city center, ${catalog().policies.timing}`);
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
      { id: 'menu_visit', title: '📅 Visit book karein' },
      { id: 'menu_staff', title: '👤 Staff se baat' },
    ]);
    return true;
  }

  // ── Reserve: "reserve reno13" ──
  if (text.startsWith('reserve')) {
    const p = findProduct(text.split(/\s+/)[1] || '');
    if (!p) {
      await wa.sendText(from, 'Kaunsa phone reserve karna hai? Maslan: "reserve reno13"');
      return true;
    }
    if (p.stock < 1) {
      await wa.sendText(from, `😔 *${p.name}* abhi stock mein nahi. "watch ${p.id}" likhein — stock aate hi sab se pehle aapko khabar milegi!`);
      return true;
    }
    await wa.sendText(from, `✅ *RESERVED!* 🎉\n\n📱 ${p.name} (${p.variant})\n💰 ${formatPrice(p.price)}\n⏰ 24 ghante tak aapke naam par\n🎟️ Token: *NK-${Date.now().toString().slice(-6)}*\n\nStore par token dikha kar le jayein. ${catalog().policies.reserve}`);
    return true;
  }

  // ── Location ──
  if (text.includes('location') || text.includes('address') || text.includes('pata')) {
    await wa.sendText(from, '📍 *OPPO Experience Store Khanewal*\nMain Bazaar, Khanewal city center\n\n🕙 ' + catalog().policies.timing + '\n\nGoogle Maps: https://maps.google.com/?q=Khanewal (demo link — asli pin yahan lagega)');
    return true;
  }

  return false; // is point par AI brain sambhalta hai
}
