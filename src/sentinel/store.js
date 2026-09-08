// Sentinel persistence primitives — atomic writes only (§31)
import fs from 'fs';
import path from 'path';

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback; // corrupt/missing → explicit fallback, never crash
  }
}

// Crash-safe: write temp then atomic rename (same-filesystem guarantee)
export function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

export const ensureDir = (d) => fs.mkdirSync(d, { recursive: true }) || d;
