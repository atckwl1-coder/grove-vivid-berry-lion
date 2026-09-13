/** Session JID helpers. No session-library import. */

export function digitsFromJid(jid) {
  if (jid == null) return null;
  const s = String(jid).trim();
  if (!s) return null;
  const user = s.split('@')[0].split(':')[0];
  const digits = user.replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return null;
  return digits;
}

export function digitsToJid(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(d)) return null;
  return d + '@s.whatsapp.net';
}

export function isGroupJid(jid) {
  return String(jid || '').includes('@g.us');
}

export function isStatusJid(jid) {
  const s = String(jid || '');
  return s === 'status@broadcast' || s.endsWith('@broadcast');
}
