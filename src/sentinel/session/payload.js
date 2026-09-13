/**
 * Cloud-shaped outbox payload → session send.
 * Interactive native is NOT supported: deterministic text menu.
 * Templates are NOT faked: throw SESSION_TEMPLATE_UNSUPPORTED.
 */
import { digitsToJid } from './jid.js';

export function interactiveToText(interactive = {}) {
  const body = String(interactive.body?.text || interactive.body || '').trim();
  const lines = [];
  if (body) lines.push(body);
  if (interactive.type === 'button') {
    const buttons = interactive.action?.buttons || [];
    buttons.forEach((b, i) => {
      const title = b.reply?.title || b.title || '';
      if (title) lines.push(`${i + 1}. ${title}`);
    });
    if (buttons.length) lines.push('Reply with the number or the option text.');
  } else if (interactive.type === 'list') {
    const sections = interactive.action?.sections || [];
    for (const sec of sections) {
      if (sec.title) lines.push(sec.title);
      for (const row of sec.rows || []) {
        const title = row.title || '';
        const desc = row.description ? ` — ${row.description}` : '';
        if (title) lines.push(`• ${title}${desc}`);
      }
    }
    if (sections.length) lines.push('Reply with the option text.');
  }
  return lines.join('\n').trim();
}

export function mapCloudPayload(payload = {}) {
  const jid = digitsToJid(payload.to);
  if (!jid) {
    const e = new Error('SESSION_BAD_TO');
    e.code = 'SESSION_BAD_TO';
    throw e;
  }
  const type = payload.type;

  if (type === 'text') {
    const text = payload.text?.body;
    if (!text) {
      const e = new Error('SESSION_EMPTY_TEXT');
      e.code = 'SESSION_EMPTY_TEXT';
      throw e;
    }
    return { jid, content: { text: String(text) }, fallback: false };
  }

  if (type === 'interactive') {
    const text = interactiveToText(payload.interactive);
    if (!text) {
      const e = new Error('SESSION_EMPTY_TEXT');
      e.code = 'SESSION_EMPTY_TEXT';
      throw e;
    }
    return { jid, content: { text }, fallback: true, fallbackOf: 'interactive' };
  }

  if (type === 'image') {
    const link = payload.image?.link;
    const caption = payload.image?.caption || '';
    if (link) return { jid, content: { image: { url: link }, caption }, fallback: false };
    if (caption) return { jid, content: { text: caption }, fallback: true, fallbackOf: 'image' };
    const e = new Error('SESSION_IMAGE_UNSUPPORTED');
    e.code = 'SESSION_IMAGE_UNSUPPORTED';
    throw e;
  }

  if (type === 'template') {
    const e = new Error('SESSION_TEMPLATE_UNSUPPORTED');
    e.code = 'SESSION_TEMPLATE_UNSUPPORTED';
    throw e;
  }

  const e = new Error('SESSION_TYPE_UNSUPPORTED');
  e.code = 'SESSION_TYPE_UNSUPPORTED';
  e.payloadType = type;
  throw e;
}
