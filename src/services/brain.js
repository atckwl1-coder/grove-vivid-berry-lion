// ─────────────────────────────────────────────────────────────
//  🧠 NOOR BRAIN — har message ka faisla yahan hota hai
//  Order: Media → Opt-out → Flow Router → AI → Human Fallback
//  ZERO-BUG rule: AI ko kabhi doubt ho → human ko handover,
//  customer ko kabhi error nahi dikhta.
// ─────────────────────────────────────────────────────────────
import axios from 'axios';
import { config } from '../config.js';
import * as wa from './whatsapp.js';
import { routeFlow } from '../flows/router.js';
import { touchCustomer, logMessage, setConsent, updateCustomer } from './customers.js';
import { catalog, formatPrice } from './catalog.js';
import { transcribeVoiceNote, analyzePhonePhoto } from './media.js';
import { log } from '../utils/logger.js';
import * as conversations from '../sentinel/conversations.js';

export async function handleIncomingMessage(msg, profileName) {
  const from = msg.from;
  const customer = touchCustomer(from, profileName);
  await wa.markRead(msg.id);

  const text = extractText(msg);

  // ── 0. CONSENT outranks everything (anti-ban law) — even during human takeover ──
  if (text && /^(stop|band karo|band|unsubscribe|bas karo)$/i.test(text.trim())) {
    logMessage(from, 'in', msg.type, text);
    setConsent(from, false, 'user-reply');
    // CONSENT_ACK: legal duty — chokepoint guard never blocks this tagged source
    return wa.sendText(from, 'Theek hai ji ✅ Aapko ab koi offer message nahi aayegi. Jab dil kare "HI" likh dein — hum hazir hain. 🙏', { source: 'CONSENT_ACK' });
  }
  if (text && /^(offers?|deals?|deals on)$/i.test(text.trim())) {
    logMessage(from, 'in', msg.type, text);
    setConsent(from, true, 'user-reply');
    return wa.sendText(from, 'Shukriya! ✅ Ab aapko hamari best offers sab se pehle milegi. 🎉', { source: 'CONSENT_ACK' });
  }

  // ── 0.5 CAP-008 §5 wall 1: HUMAN-OWNED → AI aur flows DONO khamosh (server-side).
  //     Message context mein log hota hai taake staff poori conversation dekhe;
  //     customer ko koi bot reply NAHI jata.
  if (conversations.isSuppressed(from)) {
    const what = text || (msg.type === 'audio' ? '[voice note]' : msg.type === 'image' ? `[photo] ${msg.image?.caption || ''}` : `[${msg.type}]`);
    logMessage(from, 'in', msg.type, what);
    conversations.noteInboundWhileSuppressed(from, undefined, msg.id);
    return; // ⛔ no flow, no AI, no auto-send — invariant enforced
  }

  // ── 1. Voice note ──
  if (msg.type === 'audio') {
    const text2 = await transcribeVoiceNote(msg.audio?.id);
    logMessage(from, 'in', 'audio', text2);
    if (!text2) {
      return wa.sendText(from, 'Maaf kijiye, voice note samajh nahi aayi. Thora sa type kar dein ya dobara bhejein? 🎤');
    }
    return thinkAndReply(from, text2, customer, true);
  }

  // ── 2. Photo (trade-in / price-match / model identify) ──
  if (msg.type === 'image') {
    logMessage(from, 'in', 'image', msg.image?.caption || '');
    const analysis = await analyzePhonePhoto(msg.image?.id, msg.image?.caption || '');
    return wa.sendText(from, analysis);
  }

  logMessage(from, 'in', msg.type, text);
  if (!text) return;

  // ── 3. Flow router (menu, buttons, EMI, trade-in states) ──
  const handled = await routeFlow(from, text, msg, customer);
  if (handled) return;

  // ── 4. AI Brain ──
  return thinkAndReply(from, text, customer, false);
}

// §9: LLM sirf RECOMMEND karta hai; backend hi reason validate karta hai (closed set)
function intentToReason(intent) {
  const map = { complaint: 'COMPLAINT', ai_error: 'TECHNICAL_FAILURE', payment: 'PAYMENT', price_exception: 'PRICE_EXCEPTION', repair: 'PRODUCT_EXCEPTION' };
  return map[intent] || 'AI_UNCERTAIN';
}

// ── AI se soch kar jawab dena ──
async function thinkAndReply(from, text, customer, wasVoice) {
  const ai = await think(text, customer);

  if (ai.handoff) {
    // CAP-008: fake promise DELETED. Real escalation into the staff inbox with
    // validated reason + honest SLA wording (target, not guarantee). Ack is sent
    // INSIDE escalate() — the only window where an AI-tagged send is legal.
    const reason = intentToReason(ai.intent);
    try {
      const r = await conversations.escalate(from, reason, {
        aiInference: { intent: ai.intent, model: config.aiModel },
        ackText: (ai.reply ? ai.reply + '\n\n' : '') +
          '👤 Aapka message hamari team tak pahunch gaya hai ✅ Store timing mein hain to team ka target 5 minute ke andar jawab hai; warna kal subah 10 baje ke baad baat hogi.',
      });
      updateCustomer(from, { state: 'HUMAN' });
      return; // ack already sent (or ACK_SEND_FAILED audited); nothing more — AI is now silent
    } catch (e) {
      // Last-resort honesty: handoff machinery failed → say so, alert owner
      log.error('ESCALATION FAILED:', e?.message || e);
      return wa.sendText(from, ai.reply + '\n\n⚠️ Humare system mein masla aa gaya hai — aapki baat note kar li hai. Baraye meharbani store par rabta karein. Maafi chahte hain.');
    }
  }

  return wa.sendText(from, ai.reply);
}

// ── LLM call (locked to store data — AI apni marzi se price NAHI bana sakta) ──
async function think(text, customer) {
  if (!config.openaiKey) return ruleBasedFallback(text);

  const system = `Tum NOOR ho — ${config.storeName} ka AI concierge. Pakistan ke ek chhote shehar (Khanewal) ke mobile store ke liye kaam karte ho.

SAKHT RULES (kabhi mat todo):
1. Sirf neeche diye CATALOG ki prices/specs quote karo. Koi price khud mat banao. Catalog mein na ho to kaho "confirm kar ke batata hoon" aur handoff=true karo.
2. Customer jis language/style mein likhe (Urdu script, Roman Urdu, English) — USI mein jawab do.
3. Jawab chhota aur garm josheela ho. Zarurat ho to 1-2 emojis.
4. Customer naraaz ho, complaint ho, ya cheez catalog/policies se bahir ho → handoff=true.
5. Kabhi discount apni taraf se mat do.
6. Online reservation / visit appointment / slot / token — ye WhatsApp se available NAHI hain. Customer pooche toh waise hi sach batayein: "abhi online book nahi ho sakti — store par aayen ya staff se baat karein." Token ya hold ka waada KABHI mat karein.

STORE INFO:
- Policies: ${JSON.stringify(catalog().policies)}
- Location: Khanewal city center (map pin bhejte hain jab poochein)

CATALOG (aaj ke rates):
${catalog().products.map((p) => `- ${p.name} (${p.variant}): Rs.${p.price}, stock ${p.stock}, ${p.highlights.join(', ')}`).join('\n')}

OUTPUT sirf JSON: {"reply": "...", "handoff": false, "intent": "price_query|emi|tradein|repair|complaint|general"}`;

  try {
    const { data } = await axios.post(
      `${config.openaiBase}/chat/completions`,
      {
        model: config.aiModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      },
      { headers: { Authorization: `Bearer ${config.openaiKey}` }, timeout: 20000 }
    );
    const parsed = JSON.parse(data.choices[0].message.content);
    return { reply: String(parsed.reply || ''), handoff: Boolean(parsed.handoff), intent: parsed.intent || 'general' };
  } catch (err) {
    log.error('AI error, human fallback:', err.message);
    // ZERO-BUG promise: AI fail → graceful human handoff, customer ko pata bhi nahi chalta
    return { reply: 'Ek minute ji, main aapke liye behtareen jawab laya karta hoon. 🙏', handoff: true, intent: 'ai_error' };
  }
}

// ── DEMO mode fallback (bina AI key ke chalta hai) ──
function ruleBasedFallback(text) {
  const t = text.toLowerCase();
  const products = catalog().products;

  for (const p of products) {
    if (t.includes(p.id) || t.includes(p.name.toLowerCase().replace('oppo ', ''))) {
      return {
        reply: `📱 *${p.name}* (${p.variant})\n💰 Aaj ki price: *${formatPrice(p.price)}*\n📦 Stock: sirf ${p.stock} pieces\n✨ ${p.highlights.join(' • ')}\n\nEMI ke liye "emi ${p.id}" likhein, store timing ke liye "visit" 😊`,
        handoff: false,
        intent: 'price_query',
      };
    }
  }
  if (t.includes('timing') || t.includes('khula') || t.includes('time')) {
    return { reply: `🕙 ${catalog().policies.timing}\n📍 Khanewal city center — "location" likhein to map pin bhejta hoon!`, handoff: false, intent: 'general' };
  }
  if (t.includes('warranty') || t.includes('pta')) {
    return { reply: `✅ ${catalog().policies.warranty}\nIMEI check ke liye apna IMEI number bhejein: *#06# dabaa kar nikal lein.`, handoff: false, intent: 'general' };
  }
  if (t.includes('complaint') || t.includes('masla') || t.includes('kharab')) {
    return { reply: 'Maaf chahta hoon aapko takleef hui. Aapki baat mere liye bohat ahem hai. 🙏', handoff: true, intent: 'complaint' };
  }
  return {
    reply: `Assalam o Alaikum! 😊 Main *NOOR* hoon — ${config.storeName} ka assistant.\n\n"menu" likhein — prices, EMI, trade-in, sab kuch ek jagah! 📱`,
    handoff: false,
    intent: 'greeting',
  };
}

// Staff ko alert (live mode mein template/whatsapp, demo mein log)
async function notifyStaff(customerPhone, text, intent) {
  const alert = `🚨 *HANDOFF NEEDED*\nCustomer: +${customerPhone}\nIntent: ${intent}\nMessage: ${text.slice(0, 200)}`;
  log.warn(alert.replace(/\*/g, ''));
  if (config.ownerPhone) await wa.sendText(config.ownerPhone, alert).catch(() => {});
}

const extractText = (msg) =>
  msg.text?.body || msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || '';
