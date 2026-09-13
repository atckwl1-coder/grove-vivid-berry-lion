/** Session JID helpers. No session-library import. */

export function isGroupJid(jid) {
  return String(jid || '').includes('@g.us');
}

export function isStatusJid(jid) {
  const s = String(jid || '');
  return s === 'status@broadcast' || s.endsWith('@broadcast');
}

export function isLidJid(jid) {
  return String(jid || '').endsWith('@lid');
}

export function isUserPnJid(jid) {
  const s = String(jid || '');
  return s.endsWith('@s.whatsapp.net') || s.endsWith('@c.us');
}

/**
 * Phone digits from a PN user JID only.
 * @lid is NOT a phone — never treat the LID identifier as a customer number.
 */
export function digitsFromJid(jid) {
  if (jid == null) return null;
  const s = String(jid).trim();
  if (!s) return null;
  if (isLidJid(s) || isGroupJid(s) || isStatusJid(s)) return null;
  if (s.includes('@') && !isUserPnJid(s)) return null;
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

/** PN from sender_pn / participant_pn hints (may be JID or bare digits). */
export function digitsFromPnHint(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (isLidJid(s) || isGroupJid(s) || isStatusJid(s)) return null;
  if (s.includes('@')) return digitsFromJid(s);
  const digits = s.replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return null;
  return digits;
}

/**
 * Customer phone for a session upsert.
 * Prefer remote PN JID; for @lid use key.senderPn / participantPn.
 */
export function phoneFromSessionMessage(msg) {
  const remote = msg?.key?.remoteJid;
  const fromRemote = digitsFromJid(remote);
  if (fromRemote) return fromRemote;
  const hints = [
    msg?.key?.senderPn,
    msg?.key?.participantPn,
    msg?.senderPn,
  ];
  for (const h of hints) {
    const d = digitsFromPnHint(h);
    if (d) return d;
  }
  return null;
}
