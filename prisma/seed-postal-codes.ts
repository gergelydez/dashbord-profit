/**
 * prisma/seed-postal-codes.ts
 * One-time import of prisma/data/ro-postal-codes.csv into RoPostalCode.
 * Idempotent: skips if the table already has rows (pass --force to re-import).
 *
 * Usage: node --loader ts-node/esm prisma/seed-postal-codes.ts [--force]
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from '../lib/db';
import { normalizeText, normalizeStreet } from '../lib/address/ro-postal-codes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, 'data', 'ro-postal-codes.csv');
const BATCH_SIZE = 5000;

/** Minimal RFC4180 CSV line parser — handles quoted fields with embedded commas/quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c === '\r') {
      // skip, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const force = process.argv.includes('--force');

  const existing = await db.roPostalCode.count();
  if (existing > 0 && !force) {
    console.log(`[seed-postal-codes] RoPostalCode already has ${existing} rows — skipping (pass --force to re-import).`);
    return;
  }

  console.log('[seed-postal-codes] Reading', CSV_PATH);
  const raw = readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, ''); // strip BOM if present
  const rows = parseCsv(raw);
  const [header, ...dataRows] = rows;
  const idx = {
    judet: header.indexOf('judet'),
    localitate: header.indexOf('localitate'),
    strada: header.indexOf('strada'),
    zip: header.indexOf('zip'),
  };
  if (Object.values(idx).some(i => i === -1)) {
    throw new Error(`CSV header missing expected columns. Got: ${header.join(',')}`);
  }

  const records = dataRows
    .filter(r => r.length >= 4 && r[idx.zip])
    .map(r => {
      const strada = r[idx.strada] || null;
      return {
        judet: r[idx.judet],
        localitate: r[idx.localitate],
        strada,
        zip: r[idx.zip],
        judetNorm: normalizeText(r[idx.judet]),
        localitateNorm: normalizeText(r[idx.localitate]),
        stradaNorm: strada ? normalizeStreet(strada) || null : null,
      };
    });

  console.log(`[seed-postal-codes] Parsed ${records.length} rows. Importing in batches of ${BATCH_SIZE}...`);

  if (force && existing > 0) {
    await db.roPostalCode.deleteMany({});
    console.log('[seed-postal-codes] Cleared existing rows (--force).');
  }

  let imported = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await db.roPostalCode.createMany({ data: batch });
    imported += batch.length;
    console.log(`[seed-postal-codes] ${imported}/${records.length}`);
  }

  console.log('[seed-postal-codes] Done.');
}

main()
  .catch(e => { console.error('[seed-postal-codes] Failed:', e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
