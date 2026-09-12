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

// Crash-safe: write temp, fsync, then atomic rename (same-filesystem guarantee).
// A crash mid-write leaves the previous complete file in place; the dest is
// never a truncated JSON document.
export function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const data = JSON.stringify(obj, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export const ensureDir = (d) => fs.mkdirSync(d, { recursive: true }) || d;
