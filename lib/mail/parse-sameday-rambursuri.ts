/**
 * lib/mail/parse-sameday-rambursuri.ts
 * Sums the "Sumă" column of one Sameday rambursuri xlsx.
 *
 * Format confirmed from a real, already-working standalone GLS/Sameday
 * report tool the user has: two sheets, "client" (a short info block) and
 * "expeditii" (the actual line items) — header at row 1, data from row 2,
 * columns by index: 0=AWB, 1=destinatar, 2=județ, 3=oraș, 4=adresă,
 * 5=(gap), 6=referință client, 7=sumă, 8=data livrării, 9=data colectării,
 * 10=nr. colete.
 */
import * as XLSX from 'xlsx';

export interface SamedayRambursuriResult {
  total: number;
  headerFound: boolean;
  sheetNames: string[];
  rowCount: number;
  sampleRows?: string[][];
  headerHex?: string;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function sumSamedayRambursuriXlsx(buffer: Buffer): SamedayRambursuriResult {
  const headerHex = buffer.subarray(0, 16).toString('hex');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = wb.SheetNames;
  const sheet = wb.Sheets['expeditii'] || wb.Sheets[sheetNames[1]] || wb.Sheets[sheetNames[0]];
  if (!sheet) return { total: 0, headerFound: false, sheetNames, rowCount: 0, headerHex };

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  let total = 0;
  let dataRows = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    dataRows++;
    total += toNum(row[7]);
  }

  if (dataRows === 0) {
    const sampleRows = rows.slice(0, 12).map(row => (row || []).map(c => String(c ?? '')));
    return { total: 0, headerFound: false, sheetNames, rowCount: rows.length, sampleRows, headerHex };
  }

  return { total: Math.round(total * 100) / 100, headerFound: true, sheetNames, rowCount: rows.length };
}
