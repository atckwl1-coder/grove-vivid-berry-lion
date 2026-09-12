// ─────────────────────────────────────────────────────────────
//  OWNER OPS PAGE — server-rendered, inline CSS, no JS frameworks
//  Aesthetic matches src/inbox/views.js (green header). Deterministic
//  numbers only. Null KPIs render as UNKNOWN (never a fake 0).
//  Route gating is LEAD's job — this module only renders.
// ─────────────────────────────────────────────────────────────

const css = `
body{font-family:system-ui,sans-serif;margin:0;background:#f4f5f7;color:#1f2937}
header{background:#075E54;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center}
header b{font-size:16px} header a{color:#cde; margin-left:auto}
.wrap{max-width:860px;margin:18px auto;background:#fff;border:1px solid #ddd;border-radius:8px;padding:14px}
table{width:100%;border-collapse:collapse} td,th{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
.pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;background:#e5e7eb}
.st-QUEUED{background:#fef3c7}.st-CLAIMED,.st-HUMAN_ACTIVE{background:#dbeafe}.st-RESOLVED,.st-CLOSED,.st-AI_ACTIVE{background:#d1fae5}
.sla-ok{color:#047857}.sla-soon{color:#b45309}.sla-bad{color:#b91c1c;font-weight:700}
.facts{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:13px;margin:10px 0}
.err{background:#fee2e2;border:1px solid #fca5a5;padding:10px;border-radius:6px;margin:10px 0}
.inf{background:#fff7ed;border:1px solid #fdba74;padding:8px;border-radius:6px;font-size:13px;margin:8px 0}
.tag{font-size:11px;color:#6b7280}
.st-STOPPED{background:#fee2e2;color:#991b1b}.st-ACTIVE{background:#d1fae5;color:#065f46}
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (v) => (v === null || v === undefined) ? '<span class="sla-bad">UNKNOWN</span>' : esc(v);

function row(metric, value, source) {
  return `<tr><td>${esc(metric)}</td><td>${fmt(value)}</td><td class=tag>${esc(source)}</td></tr>`;
}

export function opsPage(actor, snap, csrf = '') {
  void csrf;
  const a = actor || {};
  const s = snap || {};
  const t = s.transport || {};
  const kill = s.kill || {};
  const cat = s.catalog || {};
  const stopped = kill.state === 'AUTOMATION_STOPPED';
  const partial = s.completeness === 'PARTIAL';
  const mode = t.mode === 'LIVE' ? 'LIVE' : 'DEMO';

  const partialBanner = partial
    ? '<div class=err><b>PARTIAL — some sources unreadable</b> — missing numbers are UNKNOWN, not zero.</div>'
    : '<div class=facts>Completeness <b>OK</b> — every number below was computed from a readable source. Empty lists are 0.</div>';

  const killBanner = stopped
    ? `<div class=err>🛑 <b>AUTOMATION STOPPED</b> by ${esc(kill.stopped_by || '?')} — autonomous sends are blocked.</div>`
    : `<div class=facts>🟢 Kill: <span class="pill st-ACTIVE">${esc(kill.state || 'AUTOMATION_ACTIVE')}</span> · stopped_by: ${esc(kill.stopped_by ?? '—')}</div>`;

  const staleN = cat.stale === null || cat.stale === undefined ? 'UNKNOWN' : cat.stale;
  const staleClass = (Number(cat.stale) > 0) ? 'sla-soon' : 'sla-ok';

  const body = `
${partialBanner}
${killBanner}
<div class=facts>
  <b>TRANSPORT (D-010 facts — not a live probe)</b><br>
  Current: <b>${esc(t.current || 'Meta Cloud API')}</b>
  · QR: <b>${esc(t.qr || 'NOT IMPLEMENTED')}</b>
  · Mode: <b>${esc(mode)}</b>
  · live delivery <b>IMPLEMENTED BUT UNPROVEN</b>
  <p class=tag>isLive() selects DEMO vs LIVE. LIVE does not mean a customer message was delivered. QR / session transport is NOT IMPLEMENTED.</p>
</div>
<div class=facts>
  <b>CATALOG</b>
  · corrupted: <b>${esc(cat.corrupted === true ? 'yes' : cat.corrupted === false ? 'no' : 'UNKNOWN')}</b>
  · verified: ${fmt(cat.verified)}
  · <span class="${staleClass}">stale: ${esc(staleN)}</span>
  · unknown: ${fmt(cat.unknown)}
  · total: ${fmt(cat.total)}
  <p class=tag>source: catalog() + productStatus per product (VERIFIED ≤24h, else STALE / UNKNOWN)</p>
</div>
<h3>Owner snapshot <span class=tag>${esc(s.generated_at || '')}</span></h3>
<table>
<tr><th>Metric</th><th>Value</th><th>Source</th></tr>
${row('conversations_today', s.conversations_today, 'db.messages dir=in, UTC date of now')}
${row('customers_total', s.customers_total, 'allCustomers()')}
${row('active_leads', s.active_leads, 'qualification.stage in curious…purchase_ready')}
${row('high_intent', s.high_intent, 'stage in high_intent,negotiation,purchase_ready')}
${row('negotiations_active', s.negotiations_active, 'stateData.negotiation.active')}
${row('human_escalations', s.human_escalations, 'listConversations QUEUED|CLAIMED|HUMAN_ACTIVE')}
${row('paid_sales', s.paid_sales, "negotiationOutcomes sale + verification=paid")}
${row('stated_unpaid', s.stated_unpaid, 'sale + verification=customer_statement')}
${row('pending_followups', s.pending_followups, 'followups SCHEDULED|QUEUED')}
${row('unresolved_issues', s.unresolved_issues, 'followups status=ESCALATED')}
${row('monetary_rejects', s.monetary_rejects, 'audit.jsonl type=LLM_NUMBER_REJECTED')}
</table>
<p class=tag><a href="/inbox">← back to inbox</a> · Staff can view if route allows — route will be OWNER gated by LEAD.</p>
<p class=tag>Deterministic owner snapshot. No session tokens, passwords, or WhatsApp tokens on this page.</p>`;

  return `<!doctype html><meta charset=utf-8><title>Owner Ops · NOOR Inbox</title><style>${css}</style>
<header><b>🌙 NOOR Owner Ops</b><span>${esc(a.staffId)} · ${esc(a.role)} · tenant:${esc(a.tenant)}</span>
<a href="/inbox">inbox</a></header><div class=wrap>${body}</div>`;
}
