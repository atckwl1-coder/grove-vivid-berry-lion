// ─────────────────────────────────────────────────────────────
//  CUSTOMER MEMORY — halka JSON database (baad mein SQLite/Postgres)
//  Har customer ki yaaddasht: naam, language, opt-in, engagement
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let db = { customers: {}, messages: [], reservations: [], campaigns: [] };

export function loadDb() {
  try {
    if (fs.existsSync(config.dbFile)) {
      db = JSON.parse(fs.readFileSync(config.dbFile, 'utf8'));
    }
  } catch {
    console.log('DB corrupt ya missing — fresh start');
  }
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
}

function save() {
  fs.writeFileSync(config.dbFile, JSON.stringify(db, null, 2));
}

// Customer ko touch karo — naya ho to banao, engagement update karo
export function touchCustomer(phone, name = '') {
  if (!db.customers[phone]) {
    db.customers[phone] = {
      phone,
      name,
      language: 'roman-ur',
      optedIn: false,      // marketing sirf tab jab true
      optedOut: false,
      engagement: 50,      // 0–100 anti-ban score
      state: 'IDLE',       // conversation flow state
      stateData: {},
      lastSeen: new Date().toISOString(),
      marketingToday: { date: today(), count: 0 },
      history: [],
    };
  }
  const c = db.customers[phone];
  if (name && !c.name) c.name = name;
  c.lastSeen = new Date().toISOString();
  c.engagement = Math.min(100, c.engagement + 2); // message bhejna = interest
  save();
  return c;
}

export const getCustomer = (phone) => db.customers[phone];

export function updateCustomer(phone, patch) {
  Object.assign(db.customers[phone] || {}, patch);
  save();
}

// CAP-008 §6 context transfer: staff inbox reads recent history from here.
export function recentMessages(phone, n = 20) {
  return db.messages.filter((m) => m.phone === phone).slice(-n);
}

// Outbound logging via whatsapp chokepoint (wired at boot): inbox view marks [BOT] vs [STAFF•id]
export function logOutbound(phone, text, meta = {}) {
  db.messages.push({
    phone, dir: 'out', source: meta.source === 'HUMAN' ? 'HUMAN' : 'BOT',
    staffId: meta.staffId || null, text: String(text || '').slice(0, 500), at: new Date().toISOString(),
  });
  if (db.messages.length > 5000) db.messages = db.messages.slice(-4000);
  save();
}

export function logMessage(phone, dir, type, text) {
  db.messages.push({ phone, dir, type, text: (text || '').slice(0, 500), at: new Date().toISOString() });
  if (db.messages.length > 5000) db.messages = db.messages.slice(-4000);
  save();
}

export function setConsent(phone, value, source) {
  const c = touchCustomer(phone);
  c.optedIn = value;
  c.optedOut = !value;
  db.campaigns.push({ type: 'consent', phone, value, source, at: new Date().toISOString() });
  save();
}

export const allCustomers = () => Object.values(db.customers);
export const today = () => new Date().toISOString().slice(0, 10);

export function bumpMarketingCount(phone) {
  const c = touchCustomer(phone);
  if (c.marketingToday.date !== today()) c.marketingToday = { date: today(), count: 0 };
  c.marketingToday.count += 1;
  save();
}
