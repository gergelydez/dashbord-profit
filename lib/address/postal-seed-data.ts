/**
 * lib/address/postal-seed-data.ts
 * Shared CSV loader for prisma/data/ro-postal-codes.csv and
 * prisma/data/hu-postal-codes.csv, used by both the secret-gated one-time
 * admin import (app/api/admin/seed-postal-codes) and the unauthenticated
 * self-heal imports (app/api/postal-lookup/seed, .../seed-hu) — the latter
 * exist because the admin route needs a CONNECTOR_SECRET most people using
 * the app day-to-day don't have handy, and these imports are
 * idempotent/harmless (bundled data only, no user input) so gating them
 * isn't worth the friction.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeText, normalizeStreet } from './ro-postal-codes';

export interface PostalCodeRecord {
  judet: string;
  localitate: string;
  strada: string | null;
  zip: string;
  judetNorm: string;
  localitateNorm: string;
  stradaNorm: string | null;
}

export interface HuPostalCodeRecord {
  megye: string;
  telepules: string;
  resz: string | null;
  zip: string;
  megyeNorm: string;
  telepulesNorm: string;
  reszNorm: string | null;
}

/** Minimal RFC4180 CSV line parser — handles quoted fields with embedded commas/quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

let cachedRecords: PostalCodeRecord[] | null = null;

export function loadPostalCodeRecords(): PostalCodeRecord[] {
  if (cachedRecords) return cachedRecords;
  const csvPath = join(process.cwd(), 'prisma', 'data', 'ro-postal-codes.csv');
  const raw = readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
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
  cachedRecords = dataRows
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
        stradaNorm: strada ? (normalizeStreet(strada) || null) : null,
      };
    });
  return cachedRecords;
}

let cachedHuRecords: HuPostalCodeRecord[] | null = null;

export function loadHuPostalCodeRecords(): HuPostalCodeRecord[] {
  if (cachedHuRecords) return cachedHuRecords;
  const csvPath = join(process.cwd(), 'prisma', 'data', 'hu-postal-codes.csv');
  const raw = readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(raw);
  const [header, ...dataRows] = rows;
  const idx = {
    megye: header.indexOf('megye'),
    telepules: header.indexOf('telepules'),
    resz: header.indexOf('resz'),
    zip: header.indexOf('zip'),
  };
  if (Object.values(idx).some(i => i === -1)) {
    throw new Error(`CSV header missing expected columns. Got: ${header.join(',')}`);
  }
  cachedHuRecords = dataRows
    .filter(r => r.length >= 4 && r[idx.zip])
    .map(r => {
      const resz = r[idx.resz] || null;
      return {
        megye: r[idx.megye],
        telepules: r[idx.telepules],
        resz,
        zip: r[idx.zip],
        megyeNorm: normalizeText(r[idx.megye]),
        telepulesNorm: normalizeText(r[idx.telepules]),
        reszNorm: resz ? (normalizeText(resz) || null) : null,
      };
    });
  return cachedHuRecords;
}
