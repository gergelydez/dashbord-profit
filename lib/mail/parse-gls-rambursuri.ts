/**
 * lib/mail/parse-gls-rambursuri.ts
 * Sums the "Sumă ramburs" column of one GLS daily rambursuri xlsx.
 *
 * Reads cells by direct coordinate (A9, E9, ...) instead of
 * XLSX.utils.sheet_to_json({header:1}) — confirmed against a real,
 * already-working standalone GLS/Sameday report tool the user has, which
 * uses the same direct-coordinate approach specifically to avoid
 * sparse-array issues from merged cells. sheet_to_json's array-flattening
 * was confirmed unreliable here: it reported "header not found" on files
 * independently verified correct (opened directly on Drive, full columns,
 * correct totals), while reading the identical file by coordinate works.
 *
 * Fixed layout (confirmed): rows 1-8 are the preamble (company name,
 * client, email, bank account, transfer date, blank, header row), data
 * starts at row 9. A=Număr referință, B=Număr colet, C=Referire la ramb.,
 * D=Livrat la data, E=Sumă ramburs, F=currency, G=Postal Address. The
 * totals row (if present) has A blank and E holding the grand total —
 * used only to detect where data ends, the total here is always the sum
 * of the individual rows above it.
 */
import * as XLSX from 'xlsx';

export interface GlsRambursuriResult {
  total: number;
  headerFound: boolean;
  sheetNames: string[];
  rowCount: number;
  /** First few rows' cell text, only populated when no data was found at the expected fixed position — for debugging a format mismatch without needing direct file access. */
  sampleRows?: string[][];
  /** First 16 bytes as hex — a valid xlsx (a zip) must start with "504b0304". Lets a download-level corruption be told apart from a parsing bug without needing direct file access. */
  headerHex?: string;
}

function cellValue(sheet: XLSX.WorkSheet, col: string, row: number): unknown {
  const cell = sheet[`${col}${row}`] as { v?: unknown } | undefined;
  return cell ? cell.v : null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function sumGlsRambursuriXlsx(buffer: Buffer): GlsRambursuriResult {
  const headerHex = buffer.subarray(0, 16).toString('hex');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = wb.SheetNames;
  const sheet = wb.Sheets[sheetNames[0]];
  if (!sheet) return { total: 0, headerFound: false, sheetNames, rowCount: 0, headerHex };

  let total = 0;
  let dataRows = 0;
  for (let r = 9; r <= 1000; r++) {
    const ref = cellValue(sheet, 'A', r);
    if (ref === null || ref === undefined) break;
    const suma = cellValue(sheet, 'E', r);
    if (!ref && suma) break; // totals row: A blank, E holds the grand total
    dataRows++;
    total += toNum(suma);
  }

  if (dataRows === 0) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const sampleRows = rows.slice(0, 12).map(row => row.map(c => String(c ?? '')));
    return { total: 0, headerFound: false, sheetNames, rowCount: rows.length, sampleRows, headerHex };
  }

  return { total: Math.round(total * 100) / 100, headerFound: true, sheetNames, rowCount: dataRows };
}
