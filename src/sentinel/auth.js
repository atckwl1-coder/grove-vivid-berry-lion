// ─────────────────────────────────────────────────────────────
//  CAP-008 §2 — STAFF AUTH (OWNER/STAFF only)
//  Credentials: scrypt-hashed, seeded from env on first boot — NEVER hardcoded, NEVER plaintext.
//  Sessions: server-side token store (cookie = random 32B); browser holds no truth.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { ensureDir, atomicWriteJson } from './store.js';
import { audit } from './audit.js';

const ROLE = { OWNER: 'OWNER', STAFF: 'STAFF' };
export const ROLES = Object.freeze(ROLE);

const staffPath = () => config.staffFile;
const sessDir = () => config.sessionsDir;

const scrypt = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');

// ── Seed staff ONCE from env; refuse LIVE boot without it (Sentinel boot-gate family) ──
export function seedStaffIfMissing() {
  ensureDir(path.dirname(staffPath()));
  if (fs.existsSync(staffPath())) return false;
  let seed = [];
  try { seed = JSON.parse(process.env.STAFF_SEED_JSON || '[]'); } catch { seed = []; }
  const staff = {};
  for (const u of seed) {
    if (!u?.id || !u?.password || !ROLE[u.role]) throw new Error(`STAFF_SEED_JSON invalid entry: ${u?.id || '(no id)'}`);
    const salt = crypto.randomBytes(16).toString('hex');
    staff[u.id] = { id: u.id, role: u.role, tenant: u.tenant || config.tenantId, salt, hash: scrypt(u.password, salt), createdAt: new Date().toISOString() };
    delete u.password;
  }
  if (!Object.keys(staff).length) {
    if (config.insecureDemoAuth) {
      // DEMO-only labeled seed — printed once, never a production path
      const demoPw = crypto.randomBytes(9).toString('base64url');
      const salt = crypto.randomBytes(16).toString('hex');
      staff['owner-demo'] = { id: 'owner-demo', role: 'OWNER', tenant: config.tenantId, salt, hash: scrypt(demoPw, salt), createdAt: new Date().toISOString() };
      console.log(`⚠️  [DEMO AUTH] staff seeded: id=owner-demo password=${demoPw} (set STAFF_SEED_JSON for real deployment; NOT production evidence)`);
    } else {
      throw new Error('SENTINEL BOOT REFUSAL: no staff credentials (set STAFF_SEED_JSON). CAP-008 cannot run unauthenticated.');
    }
  }
  atomicWriteJson(staffPath(), staff);
  try { fs.chmodSync(staffPath(), 0o600); } catch {}
  return true;
}

export function assertStaffSafety() {
  if (!config.insecureDemoAuth && !fs.existsSync(staffPath()) && !process.env.STAFF_SEED_JSON) {
    throw new Error('SENTINEL BOOT REFUSAL: LIVE requires STAFF_SEED_JSON (staff credentials from secure config).');
  }
  if (!config.insecureDemoAuth && !process.env.SESSION_SECRET) {
    throw new Error('SENTINEL BOOT REFUSAL: LIVE requires SESSION_SECRET.');
  }
}

export function verifyLogin(id, password) {
  const staff = safeStaff();
  const u = staff[id];
  if (!u) { audit('LOGIN_FAILED', { staffId: id, why: 'unknown_id' }); return null; }
  const ok = crypto.timingSafeEqual(Buffer.from(scrypt(password, u.salt)), Buffer.from(u.hash));
  if (!ok) { audit('LOGIN_FAILED', { staffId: id, why: 'bad_password' }); return null; }
  audit('LOGIN_OK', { staffId: id, role: u.role });
  return createSession(u);
}

function safeStaff() { try { return JSON.parse(fs.readFileSync(staffPath(), 'utf8')); } catch { return {}; } }

// ── Sessions (server-side truth; STEP 12: refresh-safe, leak-safe) ──
export function createSession(user) {
  ensureDir(sessDir());
  const token = crypto.randomBytes(32).toString('hex');
  const sess = {
    token, staffId: user.id, role: user.role, tenant: user.tenant,
    csrf: crypto.randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + config.sessionTtlMs,
  };
  atomicWriteJson(path.join(sessDir(), `${token}.json`), sess);
  return sess;
}

export function destroySession(token) {
  try { fs.rmSync(path.join(sessDir(), `${token}.json`), { force: true }); } catch {}
}

// → actor | {error:'SESSION_INVALID'|'SESSION_EXPIRED'}
export function authenticate(req) {
  const token = parseCookie(req.headers.cookie, 'noor_session');
  if (!token) return { error: 'SESSION_INVALID' };
  let sess = null;
  try { sess = JSON.parse(fs.readFileSync(path.join(sessDir(), `${token}.json`), 'utf8')); } catch { /* bad/unknown token */ }
  if (!sess || sess.token !== token) { audit('LOGIN_FAILED', { why: 'forged_or_unknown_token' }); return { error: 'SESSION_INVALID' }; }
  if (Date.now() > sess.expiresAt) {
    destroySession(token);
    audit('SESSION_EXPIRED', { actor: { staffId: sess.staffId, role: sess.role }, tenant: sess.tenant });
    return { error: 'SESSION_EXPIRED' };
  }
  return { token, staffId: sess.staffId, role: sess.role, tenant: sess.tenant, csrf: sess.csrf };
}

export function checkCsrf(actor, req) {
  const sent = req.body?.csrf || req.headers['x-csrf'];
  if (!sent || sent !== actor.csrf) { audit('CSRF_MISMATCH', { actor: { staffId: actor.staffId, role: actor.role }, tenant: actor.tenant }); return false; }
  return true;
}

export function parseCookie(header, name) {
  if (!header) return null;
  const m = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export const sessionCookie = (token) =>
  `noor_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`;
export const clearCookie = () => 'noor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
