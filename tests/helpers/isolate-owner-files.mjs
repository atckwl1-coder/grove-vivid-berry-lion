// Test isolation: copy owner-authority files into a temp dir and point
// the runtime at the copies via env. Tests MUST call this before importing
// catalog/negotiation modules. The shipped src/data files are never written.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const OWNER = {
  CATALOG_FILE: 'src/data/products.json',
  NEGOTIATION_RULES_FILE: 'src/data/negotiation-rules.json',
  SALES_SKILLS_FILE: 'src/data/sales-skills.json',
};

export function shippedOwnerPath(rel) {
  return path.join(process.cwd(), rel);
}

export function shippedOwnerHashes() {
  const out = {};
  for (const rel of Object.values(OWNER)) {
    out[rel] = crypto.createHash('sha256').update(fs.readFileSync(shippedOwnerPath(rel))).digest('hex');
  }
  return out;
}

export function isolateOwnerFiles(tmpDir, { nowMs } = {}) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const copies = {};
  for (const [env, rel] of Object.entries(OWNER)) {
    const dest = path.join(tmpDir, path.basename(rel));
    fs.copyFileSync(shippedOwnerPath(rel), dest);
    process.env[env] = dest;
    copies[env] = dest;
  }
  if (nowMs != null) process.env.CATALOG_NOW_MS = String(nowMs);
  return {
    PRODUCTS_FILE: copies.CATALOG_FILE,
    RULES_FILE: copies.NEGOTIATION_RULES_FILE,
    SKILLS_FILE: copies.SALES_SKILLS_FILE,
  };
}
