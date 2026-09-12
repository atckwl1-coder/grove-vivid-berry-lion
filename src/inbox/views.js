// ─────────────────────────────────────────────────────────────
//  CAP-008 §13 — SMALLEST FUNCTIONAL INBOX UI (server-rendered, inline CSS, no JS frameworks)
// ─────────────────────────────────────────────────────────────
import { crmBriefHtml } from './brief.js';

const css = `
body{font-family:system-ui,sans-serif;margin:0;background:#f4f5f7;color:#1f2937}
header{background:#075E54;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center}
header b{font-size:16px} header a{color:#cde; margin-left:auto}
.wrap{max-width:860px;margin:18px auto;background:#fff;border:1px solid #ddd;border-radius:8px;padding:14px}
table{width:100%;border-collapse:collapse} td,th{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
.pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;background:#e5e7eb}
.st-QUEUED{background:#fef3c7}.st-CLAIMED,.st-HUMAN_ACTIVE{background:#dbeafe}.st-RESOLVED,.st-CLOSED,.st-AI_ACTIVE{background:#d1fae5}
.sla-ok{color:#047857}.sla-soon{color:#b45309}.sla-bad{color:#b91c1c;font-weight:700}
.msg{padding:6px 10px;margin:6px 0;border-radius:6px;max-width:75%;font-size:14px;white-space:pre-wrap}
.m-in{background:#fff;border:1px solid #ddd}.m-bot{background:#dcf8c6;margin-left:auto}.m-staff{background:#dbeafe;margin-left:auto}
.tag{font-size:11px;color:#6b7280}
form.inline{display:inline} input,textarea,button{font-size:14px;padding:8px;margin:4px 0}
textarea{width:100%;min-height:70px} button{cursor:pointer;border:1px solid #999;border-radius:6px;background:#075E54;color:#fff}
button.ghost{background:#fff;color:#075E54}
.facts{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:13px;margin:10px 0}
.err{background:#fee2e2;border:1px solid #fca5a5;padding:10px;border-radius:6px;margin:10px 0}
.inf{background:#fff7ed;border:1px solid #fdba74;padding:8px;border-radius:6px;font-size:13px;margin:8px 0}
`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const actionId = () => `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const pill = (st) => `<span class="pill st-${esc(st)}">${esc(st)}</span>`;
const slaBadge = (c) => {
  if (!c.slaStatus) return '<span class="sla-ok">—</span>';
  if (c.slaStatus === 'BREACHED') return '<span class="sla-bad">🔥 BREACHED</span>';
  if (c.slaStatus === 'RESOLVED') return '<span class="sla-ok">✅ RESOLVED</span>';
  const left = Date.parse(c.slaDeadline) - Date.now();
  return left < 60000 ? '<span class="sla-soon">⏳ <1m</span>' : `<span class="sla-ok">✅ ${Math.ceil(left / 60000)}m left</span>`;
};
const page = (title, actor, body) => `<!doctype html><meta charset=utf-8><title>${esc(title)} · NOOR Inbox</title><style>${css}</style>
<header><b>🌙 NOOR Human Inbox</b><span>${esc(actor.staffId)} · ${esc(actor.role)} · tenant:${esc(actor.tenant)}</span>
<a href="/inbox">list</a><a href="/inbox/logout">logout</a></header><div class=wrap>${body}</div>`;

export const loginPage = (err = '') => `<!doctype html><meta charset=utf-8><title>NOOR Staff Login</title><style>${css}</style>
<div class=wrap style="max-width:380px"><h2>🌙 NOOR Staff Login</h2>${err ? `<div class=err>${esc(err)}</div>` : ''}
<form method=post action="/inbox/login">
<input name=id placeholder="staff id" style="width:100%"><br>
<input name=password type=password placeholder="password" style="width:100%"><br>
<button style="width:100%">Login</button></form>
<p class=tag>Internal staff tool. All actions are audited.</p></div>`;

export function listPage(actor, convs, killState = { state: 'AUTOMATION_ACTIVE' }, csrf = '', err = '') {
  const rows = convs.map((c) => `<tr>
    <td>${c.unread ? '⚑ ' : ''}<a href="/inbox/c/${encodeURIComponent(c.phone)}">${esc(c.phone)}</a></td>
    <td>${esc((c.lastMessage || c.reason || '').slice(0, 60))}</td>
    <td>${pill(c.state)}</td><td>${esc(c.claimedBy || '—')}</td>
    <td>${esc(c.reason || '—')}</td><td>${slaBadge(c)}</td></tr>`).join('');
  const stopped = killState.state === 'AUTOMATION_STOPPED';
  const banner = stopped
    ? `<div class=err>🛑 <b>AUTOMATION STOPPED</b> by ${esc(killState.stopped_by || '?')}${killState.source === 'fail_closed' ? ' · ⚠️ state file unreadable — fail-closed' : ''} — autonomous sends are blocked. Staff replies still work.
       ${actor.role === 'OWNER' ? `<form method=post action="/inbox/kill/resume" class=inline>
         <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
         <input name=reason placeholder="resume reason (required)" required>
         <input name=confirm placeholder='type RESUME to confirm' required>
         <button>▶ Resume all</button></form>` : '<span class=tag>Only OWNER can resume.</span>'}</div>`
    : `<div class=facts>🟢 AUTOMATION ACTIVE ${actor.role === 'OWNER' ? `
       <form class=inline method=post action="/inbox/kill/stop">
         <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
         <input name=reason placeholder="reason (optional)">
         <button style="background:#b91c1c">🛑 STOP ALL autonomous actions</button></form>` : ''}</div>`;
  return page('Inbox', actor, `${banner}${err ? `<div class=err>${esc(err)}</div>` : ''}
<h3>Conversations (${convs.length})</h3>
<table><tr><th>Customer</th><th>Last</th><th>State</th><th>Assigned</th><th>Reason</th><th>SLA</th></tr>${rows || '<tr><td colspan=6>No escalations yet.</td></tr>'}</table>
${actor.role === 'OWNER' ? '<p><a href="/inbox/ops">Owner ops</a> · <a href="/inbox/b2">B-2 preflight</a></p>' : ''}<p class=tag>Auto-sort: QUEUED first, then unread count, then SLA pressure.</p>`);
}

export function convoPage(actor, conv, msgs, csrf, err = '', info = '', sales = [], brief = {}) {
  const msgsHtml = msgs.map((m) => {
    const cls = m.dir === 'in' ? 'm-in' : m.source === 'HUMAN' ? 'm-staff' : 'm-bot';
    const tag = m.dir === 'in' ? `[CUSTOMER MESSAGE]` : m.source === 'HUMAN' ? `[STAFF • ${esc(m.staffId || '?')}]` : '[BOT]';
    return `<div class="msg ${cls}"><span class=tag>${tag} ${esc(m.at)}</span><br>${esc(m.text)}</div>`;
  }).join('') || '<p class=tag>No messages logged yet.</p>';

  const isOwner = actor.role === 'OWNER' || conv.claimedBy === actor.staffId;
  const claimBtn = conv.state === 'QUEUED'
    ? `<form class=inline method=post action="/inbox/c/${encodeURIComponent(conv.phone)}/claim">
      <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
      <button>✋ Claim</button></form>` : '';
  const humanTools = (conv.state === 'CLAIMED' || conv.state === 'HUMAN_ACTIVE') && isOwner ? `
    <h4>Reply as ${esc(actor.staffId)}</h4>
    <form method=post action="/inbox/c/${encodeURIComponent(conv.phone)}/reply">
      <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
      <textarea name=body placeholder="Roman Urdu/English… (goes through the durable outbox, fully audited)"></textarea>
      <button>Send via outbox</button></form>
    <form class=inline method=post action="/inbox/c/${encodeURIComponent(conv.phone)}/resolve">
      <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
      <button>✅ Resolve</button></form>
    <form class=inline method=post action="/inbox/c/${encodeURIComponent(conv.phone)}/unclaim">
      <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
      <button class=ghost>↩ Unclaim</button></form>` : '';
  const latestSale = [...(sales || [])].reverse()[0] || null;
  const paidAlready = (sales || []).some((s) => s.verification === 'paid');
  const salesRows = (sales || []).map((s) =>
    `<div>${esc(s.product || '?')} · ${esc(s.verification || '—')} · ${esc(s.at || '')}${s.sale_confirmation?.staffId ? ` · by ${esc(s.sale_confirmation.staffId)}` : ''}</div>`
  ).join('') || '<div class=tag>No stated purchase on this customer.</div>';
  const paidForm = latestSale ? `
    <form method=post action="/inbox/c/${encodeURIComponent(conv.phone)}/confirm-paid">
      <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
      <input type=hidden name=product value="${esc(latestSale.product || '')}">
      <input type=hidden name=at value="${esc(latestSale.at || '')}">
      <button ${paidAlready ? 'disabled' : ''}>${paidAlready ? 'Already PAID' : 'Mark as PAID (staff-confirmed)'}</button>
    </form>
    <p class=tag>This records store-confirmed payment. It is not a payment gateway. It does not send WhatsApp. Day-10 care uses this flag.</p>` : '<p class=tag>No stated purchase to confirm. Customer must accept a price on the negotiation path first.</p>';
  const paidPanel = `
    <div class=facts>
      <b>PAID SALE (internal — not WhatsApp, not a PSP)</b>
      ${salesRows}
      ${paidForm}
    </div>`;
  const returnBtn = conv.state === 'RESOLVED' ? `
    <form method=post action="/inbox/c/${encodeURIComponent(conv.phone)}/return-to-ai">
      <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
      <button>🤖 Return to AI (explicit)</button></form>
    <form class=inline method=post action="/inbox/c/${encodeURIComponent(conv.phone)}/close">
      <input type=hidden name=csrf value="${esc(csrf)}"><input type=hidden name=actionId value="${actionId()}">
      <button class=ghost>🗄 Close</button></form>` : '';

  return page(`Chat ${conv.phone}`, actor, `
${err ? `<div class=err>${esc(err)}</div>` : ''}${info ? `<div class=inf>${esc(info)}</div>` : ''}
<h3>${esc(conv.phone)} ${pill(conv.state)}</h3>
<div class=facts>
<b>VERIFIED FACTS (server-derived)</b><br>
Customer: ${esc(conv.phone)} · state: ${esc(conv.state)} ${slaBadge(conv)}<br>
Escalation reason: <b>${esc(conv.reason || '—')}</b> · claimed by: ${esc(conv.claimedBy || '—')}<br>
queued_at: ${esc(conv.queuedAt || '—')} · claimed_at: ${esc(conv.claimedAt || '—')} · first_human_response_at: ${esc(conv.firstHumanResponseAt || '—')}<br>
resolved_at: ${esc(conv.resolvedAt || '—')} · sla_deadline: ${esc(conv.slaDeadline || '—')} · sla_status: ${esc(conv.slaStatus || '—')}
${conv.aiInference ? `<br><b>AI INFERENCE (ESTIMATED — NOT FACT):</b> ${esc(JSON.stringify(conv.aiInference)).slice(0, 200)}` : ''}
</div>
${claimBtn}
${crmBriefHtml(brief || {})}
${paidPanel}
${msgsHtml}
${humanTools}
${returnBtn}
<p class=tag><a href="/inbox">← back to list</a> · every action above is server-authorized + audited</p>`);
}

export const errorPage = (actor, msg) => page('Error', actor, `<div class=err>${esc(msg)}</div><p><a href="/inbox">← back</a></p>`);
