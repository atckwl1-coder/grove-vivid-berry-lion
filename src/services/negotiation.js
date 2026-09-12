// ─────────────────────────────────────────────────────────────
//  V1-3 (2026-09-10) — DETERMINISTIC NEGOTIATION ENGINE (CAP-039)
//  "deterministic engine owns numbers; LLM may ONLY phrase"
//
//  PRICE AUTHORITY (owner files — the engine and the learning system
//  NEVER write them; there is no write path to them in this module):
//    src/data/negotiation-rules.json — floors + policy (owner)
//    src/data/products.json          — prices (V1-2 / CAP-003 authority)
//
//  RULES (all deterministic; the LLM is not in the numeric path):
//   • negotiation starts ONLY from the catalog (starting) price — and only
//     when that price is VERIFIED (V1-2 authority; stale/unknown → no number)
//   • floor must be RESOLVED in the owner rules file (exact number).
//     UNRESOLVED range → NO autonomous concession (never guess)
//   • concession = ONE bounded step per customer turn:
//     step = round(start × policy.concession_step_pct / 100)  [owner-tunable]
//     next offer = max(floor, offer − step)  → NEVER below floor
//     the floor is the FINAL autonomous position
//   • VALUE-FIRST: a concession requires (a value skill already used in this
//     session) OR (the customer stated an explicit price to pay at).
//     A bare "discount do" earns a value response, not a number.
//   • ready-to-buy → CLOSE at the current (highest approved) offer —
//     never volunteer a lower price
//   • below-floor request → bounded counter, floor line, then CAP-008
//     human path (PRICE_EXCEPTION) — never a below-floor number, never a
//     fabricated "owner approval"
//   • re-open after walk: resume at the LAST authorized position (never
//     above the starting price, never below the floor)
//
//  LEARNING (tactics ONLY, structural guarantee):
//   • outcomes are captured from engine events (verification=
//     'customer_statement' — no payment system in this deployment;
//     a sale is a customer-stated acceptance, never a verified payment)
//   • skill ranking = base match + learned win-rate (uses ≥ 3) — applied
//     to NON-GATED (value) skills only
//   • authority_gated skills (SK-09 concession, SK-12 floor protection)
//     are NEVER ranked/selected by learning — they fire only on the
//     structural gates. Floors, prices, permissions, business terms:
//     read-only here. Learning changes tactics; owner rules change authority.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { catalog, findProduct, productStatus, formatPrice, observedAtIso, catalogEvidence, approvedBenefitsLine, priceCardLine, stockLine } from './catalog.js';
import { getCustomer, updateCustomer, recordNegotiation, negotiationOutcomes } from './customers.js';
import * as wa from './whatsapp.js';
import { escalate } from '../sentinel/conversations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_FILE = path.join(__dirname, '../data/negotiation-rules.json');
const DEFAULT_SKILLS_FILE = path.join(__dirname, '../data/sales-skills.json');

const rulesFile = () => process.env.NEGOTIATION_RULES_FILE || DEFAULT_RULES_FILE;
const skillsFile = () => process.env.SALES_SKILLS_FILE || DEFAULT_SKILLS_FILE;

const CORRUPT_RULES = Object.freeze({ corrupted: true, products: {}, policy: {} });
const VALUE_SKILLS = ['SK-01', 'SK-02', 'SK-03', 'SK-04', 'SK-05', 'SK-06', 'SK-07', 'SK-08'];
const DEFAULT_STEP_PCT = 1.0; // documented default when the owner file lacks a valid policy value

// ── owner authority (read-only) ──
export function loadRules() {
  try {
    const r = JSON.parse(fs.readFileSync(rulesFile(), 'utf8'));
    if (!r || typeof r !== 'object' || typeof r.products !== 'object' || r.products === null) throw new Error('bad schema');
    return r;
  } catch {
    return CORRUPT_RULES;
  }
}

export function loadSkills() {
  try {
    const s = JSON.parse(fs.readFileSync(skillsFile(), 'utf8'));
    if (!Array.isArray(s?.skills) || s.skills.length === 0) throw new Error('bad schema');
    return s.skills;
  } catch {
    return [];
  }
}

export function concessionStep(start, rules = loadRules()) {
  const pct = rules?.policy?.concession_step_pct;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 50) return Math.round((start * DEFAULT_STEP_PCT) / 100);
  return Math.round((start * pct) / 100);
}

// floor authority check (RESOLVED + valid number). A malformed floor is NOT
// a floor: it simply disables autonomous concession for that product.
export function floorAuthority(rules, productId) {
  if (!rules || rules.corrupted) return { ok: false, floor: null, status: 'NO_RULES' };
  const rule = rules.products?.[productId];
  if (!rule) return { ok: false, floor: null, status: 'MISSING' };
  if (rule.floor_status !== 'RESOLVED') return { ok: false, floor: null, status: 'UNRESOLVED' };
  if (typeof rule.floor !== 'number' || !Number.isFinite(rule.floor) || rule.floor <= 0) return { ok: false, floor: null, status: 'MALFORMED' };
  return { ok: true, floor: rule.floor, status: 'RESOLVED' };
}

// ── deterministic signal extraction (LLM may interpret in the fallback path;
//    the numeric path works on these deterministic signals) ──
const BID_VERB = /\b(par|mein|karo|karein|de do|dein|le raha|le leta|le deta|le leti|payment|accept|chahiye|final|book|order)\b/;

export function extractSignals(rawText) {
  const t = (rawText || '').toLowerCase();
  const sig = { asked_price: null, accept: false, walk: false, objection: null, explicit_discount_request: false };

  // explicit price-to-pay: "195k", "195 mein", "195000 par", "198 k le raha" —
  // ONLY with bid context (a quote of the current price, "200k zyada hai",
  // is an objection, not a bid). Percent-style numbers ("50% discount") are
  // never prices.
  if (BID_VERB.test(t)) {
    const notPercent = (idx) => !/%|percent/.test(t.slice(idx, idx + 12));
    let m = t.match(/(\d{5,7})(?!\d)/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v >= 10000) sig.asked_price = v;
    }
    if (sig.asked_price === null) {
      m = t.match(/(?<!\d)(\d{2,3})\s*(k|thousand|saya|lag)\b(?!\d)/);
      if (m && notPercent(m.index)) sig.asked_price = parseInt(m[1], 10) * 1000;
    }
    if (sig.asked_price === null) {
      m = t.match(/(?<!\d)(\d{2,3})(?!\d)\s*(mein|par|karo|karein|de do|dein)\b/);
      if (m && notPercent(m.index) && parseInt(m[1], 10) >= 10) sig.asked_price = parseInt(m[1], 10) * 1000;
    }
  }
  if (/\b(accept|payment|le raha|le leta|le deta|le leti|book kar|order kar|haan theek|theek hai theek)\b/.test(t)) sig.accept = true;
  if (/(na chahiye|chahiye nahi|nahi chahiye|phir baat|baad mein|soch ke bata|chhod do|alvida|\bbye\b)/.test(t)) sig.walk = true;

  if (/(market|dusre store|other store|kisi dukan|competitor|koi aur shop|aur jagah)/.test(t)) sig.objection = 'competitor';
  if (!sig.objection && /(budget|haath nahi aata|paise kam|salary|emi se hi|installment se hi)/.test(t)) sig.objection = 'budget';
  if (!sig.objection && /(trust|bharosa|original kya|fake|quality kya|zayafa)/.test(t)) sig.objection = 'trust';
  if (!sig.objection && /(camera|battery|display|gaming|specs?)/.test(t)) sig.objection = 'feature';
  const priceObjection = /(zyada hai|expensive|mehnga|sasta|kam karo|kam karein|kam ho jaye|discount|rehai|rehaan|chhoot|deal do|last price|final price|negotiat)/.test(t);
  if (priceObjection && (!sig.objection || sig.objection === 'feature')) sig.objection = 'price';
  if (/(discount|sasta karo|kam karo|kam karein|chhoot|rehaan do|rehain)/.test(t)) sig.explicit_discount_request = true;
  return sig;
}

// V1-5′ H1: PRICE / COST / FINAL PRICE questions for SKUs that have an
// owner negotiation rule must not fall through to the LLM. Detected
// separately from extractSignals so a bare "reno16 ki price?" is a
// catalog-authority read, not a concession session.
export function isPriceQuery(rawText) {
  const t = (rawText || '').toLowerCase();
  if (/\b(price|qemat|qeemat|keemat|kimat|cost|rate)\b/.test(t)) return true;
  if (/kitne\s*ka/.test(t)) return true;
  if (/kitna\s*(hai|ka|hoga|he)/.test(t)) return true;
  if (/kitni\s*(hai|price|qemat)/.test(t)) return true;
  if (/final\s*price/.test(t)) return true;
  return false;
}

// ── learning: derived from captured outcomes ONLY (never from LLM text) ──
export function skillStats() {
  const stats = {};
  for (const rec of negotiationOutcomes()) {
    if (typeof rec?.outcome !== 'string') continue;
    for (const id of Array.isArray(rec.skills) ? rec.skills : []) {
      if (!stats[id]) stats[id] = { uses: 0, wins: 0, losses: 0 };
      stats[id].uses += 1;
      if (rec.outcome === 'sale') stats[id].wins += 1;
      else if (rec.outcome === 'no_sale') stats[id].losses += 1;
    }
  }
  return stats;
}

// Deterministic selection: base priority for the objection (library
// `priority` map, falling back to preferred_signals membership) + learned
// win-rate (uses ≥ 3). Gated skills are structurally excluded from the pool.
// Ties keep library order (stable, no randomness).
export function selectSkill(objection) {
  const skills = loadSkills();
  if (!skills.length) return null; // corrupt library → neutral line (no crash, no invented value)
  const pool = skills.filter((s) => !s.authority_gated && s.status === 'approved');
  if (!pool.length) return null;
  const stats = skillStats();
  const scored = [];
  pool.forEach((s) => {
    const pref = Array.isArray(s.preferred_signals) ? s.preferred_signals : [];
    const base = (s.priority && typeof s.priority[objection] === 'number')
      ? s.priority[objection]
      : (pref.includes(objection) ? 1 : 0);
    if (base <= 0) return;
    const st = stats[s.skill_id] || { uses: 0, wins: 0 };
    const learned = st.uses >= 3 ? st.wins / st.uses : 0;
    scored.push({ s, score: base + learned });
  });
  if (!scored.length) return pool.find((s) => s.skill_id === 'SK-02') || pool[0];
  scored.sort((a, b) => b.score - a.score || pool.indexOf(a.s) - pool.indexOf(b.s));
  return scored[0].s;
}

export function latestOutcome(phone, productId) {
  const rows = negotiationOutcomes().filter((r) => r.phone === phone && r.product === productId);
  return rows.length ? rows[rows.length - 1] : null;
}

// ── skill line rendering (library is data; deterministic fallbacks keep the
//    engine honest even if the library file is corrupt) ──
const FALLBACK_LINES = {
  'SK-09': 'Ji theek hai — main apni taraf se adjust kar raha hoon: *{offer_new}*. Kya hum is par fix kar lein?',
  'SK-10': 'Kya hum *{offer}* par fix kar lein? Theek ho to store par aayen — payment aur delivery wahan hi ho jayegi. 🤝',
  'SK-12': '*{offer}* meri aakhri price hai — is se neeche main ja nahi sakta. 🙏 Kya hum is par proceed karein? Warna *staff* likhein — team aapki madad kare gi.',
};
function renderLine(skillId, vars) {
  const s = loadSkills().find((x) => x.skill_id === skillId);
  const tpl = (s && typeof s.line === 'string') ? s.line : FALLBACK_LINES[skillId] || 'Kya hum aage discuss karein?';
  return tpl
    .replace(/\{offer_new\}/g, vars.offer_new || '')
    .replace(/\{offer\}/g, vars.offer || '')
    .replace(/\{benefits\}/g, vars.benefits || '')
    .replace(/\{name\}/g, vars.name || '')
    .replace(/\{id\}/g, vars.id || '');
}

// ── product resolution from the message (explicit token, else active state) ──
function productFromText(t) {
  const tokens = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w));
  for (const tok of tokens) {
    const p = findProduct(tok);
    if (p) return p;
  }
  for (let i = 0; i + 1 < tokens.length; i++) {
    const p = findProduct(tokens[i] + tokens[i + 1]);
    if (p) return p;
  }
  return null;
}

function saveState(phone, n) {
  const c = getCustomer(phone);
  updateCustomer(phone, { stateData: { ...(c?.stateData || {}), negotiation: n } });
}

// ─────────────────────────────────────────────────────────────
//  THE TURN — deterministic decision core
// ─────────────────────────────────────────────────────────────
export async function handleNegotiation(from, rawText, msg, customer) {
  const t = (rawText || '').toLowerCase().trim();
  const n0 = customer?.stateData?.negotiation;
  const isActive = Boolean(n0 && n0.active && !['CLOSED', 'LOST', 'ESCALATED'].includes(n0.state));
  const sig = extractSignals(t);
  const priceQuery = isPriceQuery(t);
  const hasSignal = sig.asked_price !== null || sig.accept || sig.walk || sig.objection !== null || sig.explicit_discount_request;
  if (!hasSignal && !isActive && !priceQuery) return false;

  let p = productFromText(t);
  if (!p && isActive) p = findProduct(n0.product);
  if (!p) return false; // no resolvable product → normal path (brain/flows)

  // ── V1-5′ H1: plain price/cost question for a SKU with an owner rule
  //     → catalog formatter owns the number. Do not open a session and
  //     do not let the LLM become the monetary authority.
  if (priceQuery && !hasSignal && !isActive) {
    const rules = loadRules();
    const rule = rules && !rules.corrupted ? rules.products?.[p.id] : null;
    if (rule) {
      const ev = catalogEvidence(p);
      const sl = stockLine(p);
      const body =
        `📱 *${p.name}*${p.variant ? ` (${p.variant})` : ''}\n` +
        `${priceCardLine(p)}` +
        (sl ? `\n${sl}` : '');
      await wa.sendText(from, body, ev ? { source: 'AI', evidence: ev } : { source: 'AI' });
      return true;
    }
  }
  if (!hasSignal && !isActive) return false;

  // ── authority: re-read from files EVERY turn (files are the truth) ──
  const rules = loadRules();
  const { status, observedAt } = productStatus(p);
  const auth = floorAuthority(rules, p.id);
  const canNegotiate = status === 'VERIFIED' && auth.ok && auth.floor < p.price;
  const floor = auth.ok ? auth.floor : null;
  const step = concessionStep(p.price, rules);
  const evidence = catalogEvidence(p); // VERIFIED only (P2 EVIDENCE stage)

  // ── open / resume session ──
  let n = isActive ? n0 : null;
  if (!n) {
    const last = latestOutcome(from, p.id);
    const reopenAtLast = last && last.outcome === 'no_sale' && typeof last.final_offer === 'number';
    n = {
      active: true,
      product: p.id,
      start: p.price,
      offer: reopenAtLast ? Math.max(floor ?? 0, Math.min(p.price, last.final_offer)) : p.price,
      floor,
      concessions: 0,
      skills_used: [],
      objections: [],
      state: 'OPEN',
      below_floor_pushes: 0,
      outcome_recorded: false,
      reopened: Boolean(reopenAtLast),
      opened_at: new Date().toISOString(),
    };
    if (reopenAtLast) n.skills_used.push('SK-11'); // re-close after walk (last authorized position)
    saveState(from, n);
  }
  // re-anchor authority + clamp offer to the current catalog price (never above)
  if (auth.ok) n.floor = floor;
  n.offer = Math.min(n.offer, p.price);

  const fmt = (x) => formatPrice(x);
  const benefits = approvedBenefitsLine(p);
  const valueVars = { offer: fmt(n.offer), benefits: benefits || `${p.name} verified price par hi discuss ho sakti hai — staff se detail mein baat karein`, name: p.name, id: p.id };
  const send = async (text, ev) => {
    await wa.sendText(from, text, ev ? { source: 'AI', evidence: ev } : { source: 'AI' });
    return true;
  };

  const closeAt = async (price) => {
    n.skills_used.push('SK-10'); // closing is part of the sequence — record it
    if (!n.outcome_recorded) {
      recordNegotiation({
        phone: from, product: p.id, outcome: 'sale',
        start: n.start, final_offer: price, discount_amount: n.start - price,
        concessions: n.concessions, skills: [...n.skills_used], objections: [...n.objections],
        verification: 'customer_statement',
        note: 'customer-stated acceptance at an approved price; no payment system in this deployment — not a verified payment',
      });
      n.outcome_recorded = true;
    }
    n.state = 'CLOSED';
    n.active = false;
    saveState(from, n);
    const tail = benefits ? `\nAur included: ${benefits}` : '';
    return send(`Bilkul theek hai ji! *${fmt(price)}* par fix. 🤝 Store par aayen — payment aur delivery wahan hi ho jayegi.${tail}`, evidence);
  };

  const finishNoSale = (why) => {
    if (n.outcome_recorded) return;
    recordNegotiation({
      phone: from, product: p.id, outcome: 'no_sale',
      start: n.start, final_offer: n.offer, discount_amount: n.start - n.offer,
      concessions: n.concessions, skills: [...n.skills_used], objections: [...n.objections],
      verification: 'customer_statement',
      note: `conversation ended without a stated acceptance (${why})`,
    });
    n.outcome_recorded = true;
  };

  // ── 1. walk-away ──
  if (sig.walk) {
    finishNoSale('walk');
    n.state = 'LOST';
    n.active = false;
    saveState(from, n);
    return send('Theek hai ji, koi masla nahi. 🙏 Jab bhi baat karni ho — main hazir hoon. Aapki baat note kar li hai.');
  }

  // ── 2. ready-to-buy / explicit price-to-pay ──
  if (sig.accept || sig.asked_price !== null) {
    if (sig.asked_price !== null) {
      const asked = sig.asked_price;
      if (asked >= n.offer) return closeAt(n.offer); // willing at our price → CLOSE at the highest approved price
      if (canNegotiate && asked >= floor) {
        if (n.offer - asked <= step) return closeAt(asked); // within one step + pays now → accept
        // explicit price-to-pay opens the concession gate (value-first exception)
        n.offer = Math.max(floor, n.offer - step);
        n.concessions += 1;
        n.skills_used.push('SK-09');
        n.state = n.offer === floor ? 'FLOOR' : 'CONCESSION';
        saveState(from, n);
        return send(renderLine('SK-09', { offer_new: fmt(n.offer) }), evidence);
      }
      // asked below floor (or no authority) → floor protection path
      return sendBelowFloor(asked);
    }
    return closeAt(n.offer); // ready, no number → close at current offer
  }
  // HONEST no-authority response (shared by the objection branch and the
  // below-floor path): no discount, no invented number, real human path.
  // VERIFIED price may be restated (engine number, unchanged); STALE/UNKNOWN -> no number.
  async function sendNoAuthority() {
    saveState(from, n);
    if (status === 'VERIFIED') {
      const why = auth.status === 'UNRESOLVED'
        ? 'is model ki final price team ke saath hi discuss ho sakti hai'
        : 'is model par price negotiation abhi available nahi hai';
      return send(
        `Ji, ${p.name} par ${why}. \ud83d\ude4f\n\ud83d\udcb0 aaj ki price: *${fmt(n.offer)}* (verified: ${observedAtIso(observedAt)})\n\ud83d\udcac *staff* likhein \u2014 team aapki madad kare gi.`,
        evidence);
    }
    return send(
      `\u26a0\ufe0f ${p.name} ki baat sirf verified price par hi ho sakti hai. ` +
      (status === 'STALE'
        ? 'Aakhri verified price ke baad rates badal sakte hain \u2014 confirm karein.'
        : 'Price abhi confirm nahi ho sakti (verification pending).') +
      `\n\ud83d\udcac *staff* likhein \u2014 team aapki madad kare gi.`);
  }

  // \u2500\u2500 3. objection / discount request \u2500\u2500
  if (!canNegotiate) {
    return sendNoAuthority();
  }

  async function sendBelowFloor(asked) {
    if (!canNegotiate) {
      // No authority for this product (floor missing/unresolved/malformed, or
      // catalog unverified) -> a below-floor bid earns the HONEST staff path,
      // never a number. (Guarded structurally: Math.max(null, x) would
      // otherwise "concede" toward nothing.)
      n.below_floor_pushes += 1;
      saveState(from, n);
      return sendNoAuthority();
    }
    n.below_floor_pushes += 1;
    if (n.offer === floor) {
      // AT the floor: final autonomous position — floor line, then human path
      n.state = 'FLOOR';
      n.skills_used.push('SK-12');
      saveState(from, n);
      if (n.below_floor_pushes >= 2) {
        finishNoSale('below_floor');
        n.active = false;
        n.state = 'ESCALATED';
        saveState(from, n);
        try {
          await escalate(from, 'PRICE_EXCEPTION', { aiInference: { intent: 'price_exception' } });
        } catch {
          // escalate machinery failed → honest line, still never below floor
          return send(renderLine('SK-12', { offer: fmt(n.offer) }), evidence);
        }
        updateCustomer(from, { state: 'HUMAN' });
        return true; // ack already sent by escalate — engine is silent now
      }
      return send(renderLine('SK-12', { offer: fmt(n.offer) }), evidence);
    }
    // above the floor: ONE bounded counter (explicit bid context), never below floor
    n.offer = Math.max(floor, n.offer - step);
    n.concessions += 1;
    n.skills_used.push('SK-09');
    n.state = n.offer === floor ? 'FLOOR' : 'CONCESSION';
    saveState(from, n);
    return send(renderLine('SK-09', { offer_new: fmt(n.offer) }), evidence);
  }

  if (n.offer === floor) {
    // floor reached and customer still objects (no explicit bid) → floor protection
    n.state = 'FLOOR';
    n.skills_used.push('SK-12');
    n.objections.push(sig.objection || 'price');
    saveState(from, n);
    return send(renderLine('SK-12', { offer: fmt(n.offer) }), evidence);
  }

  const valueUsed = n.skills_used.some((id) => VALUE_SKILLS.includes(id));
  if (sig.explicit_discount_request && valueUsed) {
    // value-first satisfied + explicit request → ONE bounded concession
    n.offer = Math.max(floor, n.offer - step);
    n.concessions += 1;
    n.skills_used.push('SK-09');
    n.state = n.offer === floor ? 'FLOOR' : 'CONCESSION';
    saveState(from, n);
    return send(renderLine('SK-09', { offer_new: fmt(n.offer) }), evidence);
  }

  // ── value-first response (the default to ANY price pressure) ──
  const objection = sig.objection || 'price';
  const skill = selectSkill(objection);
  const text = skill ? renderLine(skill.skill_id, valueVars) : 'Ji, aapki baat note kar li hai. *staff* likhein — team detail mein help karegi.';
  n.skills_used.push(skill ? skill.skill_id : 'NONE');
  n.objections.push(objection);
  n.state = 'VALUE';
  saveState(from, n);
  return send(text, evidence);
}
