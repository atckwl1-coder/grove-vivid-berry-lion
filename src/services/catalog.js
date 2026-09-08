// Catalog service — products.json se live data (owner har roz update karta hai)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = path.join(__dirname, '../data/products.json');

export function catalog() {
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
}

export function findProduct(query) {
  const q = (query || '').toLowerCase().replace(/[\s-]/g, '');
  return catalog().products.find(
    (p) => p.id === q || p.name.toLowerCase().replace(/[\s-]/g, '').includes(q)
  );
}

export const formatPrice = (n) => 'Rs. ' + Number(n).toLocaleString('en-PK');
