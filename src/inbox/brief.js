// Staff-facing CRM brief. Renders labeled facts already computed by
// qualification/profile/care — this module does not score, send, or
// authorize prices. All customer fields are escaped.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&' + 'amp;',
  '<': '&' + 'lt;',
  '>': '&' + 'gt;',
  '"': '&' + 'quot;',
  "'": '&#39;',
}[c]));

function stageLabel(stage) {
  return String(stage || 'browsing');
}

export function recommendedNextAction(q, suppressed = false) {
  if (suppressed) return 'Staff must reply — AI is silenced';
  if (!q || typeof q !== 'object') return 'Offer menu; do not concede';
  if (q.human_owned) return q.next_action || 'Staff must reply — AI is silenced';
  return q.next_action || 'Offer menu; do not concede';
}

/**
 * @param {object} opts
 * @param {object|null} opts.qualification
 * @param {object|null} opts.profile
 * @param {object[]} opts.sales
 * @param {object[]} opts.followups
 * @param {object|null} opts.negotiation
 * @param {boolean} opts.suppressed
 */
export function crmBriefHtml({
  qualification = null,
  profile = null,
  sales = [],
  followups = [],
  negotiation = null,
  suppressed = false,
} = {}) {
  const q = qualification || {};
  const p = profile || {};
  const paid = (sales || []).some((s) => s.verification === 'paid');
  const stated = (sales || []).filter((s) => s.outcome === 'sale' || s.verification);
  const fu = (followups || []).slice(-3);
  const model = p.preferred_model?.name || p.preferred_model?.id || '—';
  const budget = p.budget && Number.isFinite(p.budget.amount)
    ? `Rs. ${p.budget.amount} (CUSTOMER_STATED — not authorized)`
    : '—';
  const objections = Array.isArray(p.objections) && p.objections.length
    ? p.objections.slice(-3).map((o) => esc(o.kind || o.raw || 'other')).join(', ')
    : '—';
  const fuRows = fu.length
    ? fu.map((f) => `${esc(f.status || '?')} · ${esc(f.product || '')}`).join('<br>')
    : 'none';
  const saleRows = stated.length
    ? stated.slice(-3).map((s) => `${esc(s.product || '?')} · ${esc(s.verification || '—')}`).join('<br>')
    : 'none';
  const neg = negotiation?.active
    ? `ACTIVE offer=${negotiation.offer ?? '—'} product=${esc(negotiation.product || '')}`
    : 'none';
  return `
    <div class=facts>
      <b>CRM BRIEF (deterministic — not LLM authority)</b><br>
      Stage: <b>${esc(stageLabel(q.stage))}</b>
      · score ${esc(q.lead_score ?? 'UNKNOWN')}
      · confidence ${esc(q.confidence || 'UNKNOWN')}
      · ${suppressed || q.human_owned ? '<b>AI SILENCED</b>' : 'AI live'}
      · paid=${paid ? 'yes' : 'no'}<br>
      Preferred model: ${esc(model)}
      · stated budget: ${esc(budget)}<br>
      Objections: ${objections}<br>
      Negotiation: ${neg}<br>
      Sales: ${saleRows}<br>
      Follow-ups: ${fuRows}<br>
      Next action: <b>${esc(recommendedNextAction(q, suppressed))}</b>
      <p class=tag>Customer-stated budget/model are untrusted. Floor/price authority is the owner catalog + negotiation engine. This panel cannot mark paid — use the PAID SALE control below.</p>
    </div>`;
}

export { esc as briefEsc };
