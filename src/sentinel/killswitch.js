// ─────────────────────────────────────────────────────────────
//  CAP-055 — OWNER KILL SWITCH (global gate for autonomous side effects)
//  Rules: server-side only · LLM/UI/customer can NEVER flip it · fail-CLOSED
//  on unreadable state · file-backed (survives restart) · idempotent by actionId
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { ensureDir, atomicWriteJson } from './store.js';
import { audit } from './audit.js';

export const KILL = Object.freeze({ ACTIVE: 'AUTOMATION_ACTIVE', STOPPED: 'AUTOMATION_STOPPED' });

// Sources allowed while STOPPED: human (actor-authorized, claimant-gated) + consent acks (legal duty, user-triggered)
export const ALLOWED_WHILE_STOPPED = Object.freeze(new Set(['HUMAN', 'CONSENT_ACK']));

const statePath = () => config.killFile;
const ACTION_RE = /^[A-Za-z0-9-]{8,80}$/;

let onStopCbs = [];
let onResumeCbs = [];
export function onKillStop(cb) { onStopCbs.push(cb); }
export function onKillResume(cb) { onResumeCbs.push(cb); }

// ── readState: FAIL-CLOSED. Genesis (ENOENT) is the only ACTIVE by default and is audited. ──
export function readState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const s = JSON.parse(raw);
    if (s.state !== KILL.ACTIVE && s.state !== KILL.STOPPED) throw new Error('unknown state');
    return { ...s, source: 'disk' };
  } catch (e) {
    if (e.code === 'ENOENT') {
      const genesis = {
        state: KILL.ACTIVE, stopped_at: null, stopped_by: null, reason: null,
        resumed_at: null, resumed_by: null, applied_actions: [], updatedAt: new Date().toISOString(),
      };
      writeState(genesis);
      audit('KILL_SWITCH_GENESIS_ACTIVE', { prev_state: null, new_state: KILL.ACTIVE, reason: 'first_boot' });
      return { ...genesis, source: 'genesis' };
    }
    // FAIL CLOSED: corrupt/unreadable ⇒ STOPPED (never "unreadable ⇒ ACTIVE")
    audit('KILL_STATE_UNREADABLE', { prev_state: null, new_state: KILL.STOPPED, reason: String(e?.message || e).slice(0, 120) });
    return {
      state: KILL.STOPPED, stopped_at: null, stopped_by: 'FAIL_CLOSED', reason: 'state_file_unreadable',
      resumed_at: null, resumed_by: null, applied_actions: [], updatedAt: null, source: 'fail_closed',
    };
  }
}
function writeState(s) { ensureDir(path.dirname(statePath())); atomicWriteJson(statePath(), s); }

export function initKill() { ensureDir(path.dirname(statePath())); readState(); } // triggers genesis if needed
export const isStopped = () => readState().state === KILL.STOPPED;

// ── Gate for the send chokepoint: (toPhone, meta) → {ok, reason?} ──
export function gateForSend(_toPhone, meta = {}) {
  const source = meta.source || 'AI';
  if (ALLOWED_WHILE_STOPPED.has(source)) return { ok: true };
  if (isStopped()) {
    audit('KILL_SEND_BLOCKED', { reason: `blocked_source:${source}`, state: KILL.STOPPED });
    return { ok: false, reason: 'KILL_SWITCH_ACTIVE' };
  }
  return { ok: true };
}

// For the outbox execute-layer: is THIS job autonomous (blockable)?
export const isAutonomousJob = (job) => !ALLOWED_WHILE_STOPPED.has(job?.meta?.source || 'AI');

const validActionId = (id) => { if (!ACTION_RE.test(String(id || ''))) { const e = new Error('ACTION_ID_REQUIRED'); e.code = 'ACTION_ID_REQUIRED'; throw e; } };
const actorEnv = (a) => ({ staffId: a.staffId, role: a.role });

// ── STOP ALL (fail-safe: minimal ceremony — the brake must be easy to pull) ──
export function stopAll(actor, actionId, reason) {
  validActionId(actionId);
  const s = readState();
  if (s.applied_actions.includes(actionId)) return { state: s.state, status: 'ALREADY_APPLIED' };
  const prev = s.state;
  const next = {
    ...s, state: KILL.STOPPED,
    stopped_at: s.state === KILL.STOPPED ? s.stopped_at : new Date().toISOString(),
    stopped_by: s.state === KILL.STOPPED ? s.stopped_by : actor.staffId,
    reason: String(reason || s.reason || '').slice(0, 200) || null,
    applied_actions: [...s.applied_actions, actionId].slice(-150),
    updatedAt: new Date().toISOString(),
  };
  writeState(next);
  audit('KILL_SWITCH_STOPPED', {
    actor: actorEnv(actor), actionId, prev_state: prev, new_state: KILL.STOPPED,
    reason: next.reason, note: prev === KILL.STOPPED ? 'already_stopped' : undefined,
  });
  if (prev !== KILL.STOPPED) for (const cb of onStopCbs) { try { cb(); } catch {} }
  return { state: next.state, status: prev === KILL.STOPPED ? 'ALREADY_STOPPED' : 'STOPPED' };
}

// ── RESUME ALL (deliberately heavier than STOP: typed confirm + reason) ──
export function resumeAll(actor, actionId, reason, confirm) {
  validActionId(actionId);
  if (confirm !== 'RESUME') { const e = new Error('CONFIRMATION_REQUIRED: send confirm:"RESUME"'); e.code = 'CONFIRMATION_REQUIRED'; throw e; }
  if (!reason || String(reason).trim().length < 4) { const e = new Error('REASON_REQUIRED'); e.code = 'REASON_REQUIRED'; throw e; }
  const s = readState();
  if (s.applied_actions.includes(actionId)) return { state: s.state, status: 'ALREADY_APPLIED' };
  const prev = s.state;
  const next = {
    ...s, state: KILL.ACTIVE,
    resumed_at: prev === KILL.STOPPED ? new Date().toISOString() : s.resumed_at,
    resumed_by: prev === KILL.STOPPED ? actor.staffId : s.resumed_by,
    applied_actions: [...s.applied_actions, actionId].slice(-150),
    updatedAt: new Date().toISOString(),
  };
  writeState(next);
  audit('KILL_SWITCH_RESUMED', {
    actor: actorEnv(actor), actionId, prev_state: prev, new_state: KILL.ACTIVE,
    reason: String(reason).slice(0, 200), note: prev === KILL.ACTIVE ? 'already_active' : undefined,
  });
  if (prev !== KILL.ACTIVE) for (const cb of onResumeCbs) { try { cb(); } catch {} }
  return { state: next.state, status: prev === KILL.ACTIVE ? 'ALREADY_ACTIVE' : 'RESUMED' };
}

export function status(actor, actionId) {
  const s = readState();
  audit('KILL_SWITCH_STATUS_CHECKED', { actor: actorEnv(actor), actionId: actionId || null, prev_state: s.state, new_state: s.state, reason: null });
  return {
    state: s.state, source: s.source,
    stopped_at: s.stopped_at, stopped_by: s.stopped_by, reason: s.reason,
    resumed_at: s.resumed_at, resumed_by: s.resumed_by,
  };
}

// Non-auditing read for UI banners (STATUS *command* audits; page decoration does not)
export function peekState() { const s = readState(); return { state: s.state, stopped_by: s.stopped_by, source: s.source }; }

export function denied(req, actor, why) {
  audit('KILL_SWITCH_DENIED', { actor: actor ? actorEnv(actor) : undefined, actionId: null, prev_state: null, new_state: null, reason: why });
}
