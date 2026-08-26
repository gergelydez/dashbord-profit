/**
 * lib/mail/parse-gls-rambursuri.ts
 * Sums the "Sumă ramburs" column of one GLS daily rambursuri xlsx
 * (format confirmed from a real sample: sheet "Daily", a header row with
 * "Număr referinta" / "Număr colet" / "Referire la ramb." / "Livrat la
 * data" / "Sumă ramburs" / currency / "Postal Address", one row per parcel,
 * then a totals row with the same columns blank except the sum).
 *
 * Deliberately re-sums the per-parcel rows instead of trusting the file's
 * own totals row: a row only counts if "Referire la ramb." is non-empty,
 * which real line items always have and the totals row never does — so
 * this comes out right whether or not a totals row is present, without
 * depending on it being the literal last row.
 */
import * as XLSX from 'xlsx';

function norm(s: unknown): string {
  return String(s ?? '')
    .replace(/ /g, ' ') // non-breaking space, common in auto-exported Excel files
    .trim()
    .toLowerCase();
}

export interface GlsRambursuriResult {
  total: number;
  headerFound: boolean;
  sheetNames: string[];
  rowCount: number;
  /** First few rows' cell text, only populated when the header wasn't found — for debugging a format mismatch without needing direct file access. */
  sampleRows?: string[][];
}

export function sumGlsRambursuriXlsx(buffer: Buffer): GlsRambursuriResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = wb.SheetNames;
  const sheet = wb.Sheets[sheetNames[0]];
  if (!sheet) return { total: 0, headerFound: false, sheetNames, rowCount: 0 };

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  let refCol = -1;
  let amountCol = -1;
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    const ref = row.findIndex(c => norm(c) === 'referire la ramb.' || norm(c).startsWith('referire la ramb'));
    const amt = row.findIndex(c => norm(c).startsWith('sumă ramburs') || norm(c).startsWith('suma ramburs'));
    if (ref !== -1 && amt !== -1) {
      refCol = ref;
      amountCol = amt;
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    const sampleRows = rows.slice(0, 12).map(row => row.map(c => String(c ?? '')));
    return { total: 0, headerFound: false, sheetNames, rowCount: rows.length, sampleRows };
  }

  let total = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const ref = row[refCol];
    const amount = row[amountCol];
    if (typeof ref === 'string' && ref.trim() && typeof amount === 'number') {
      total += amount;
    }
  }
  return { total: Math.round(total * 100) / 100, headerFound: true, sheetNames, rowCount: rows.length };
}
