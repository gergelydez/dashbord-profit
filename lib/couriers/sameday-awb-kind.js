/**
 * lib/couriers/sameday-awb-kind.js
 * Ce fel de colet e un AWB Sameday, după prefix (confirmat pe exportul din
 * contul Sameday):
 *   - conține "EMG"     → comandă eMAG (eMAG expediază prin contul nostru Sameday)
 *   - începe cu "1ONBLR" → RETUR DE LA CLIENT către noi (clientul trimite
 *                           produsul înapoi) — NU e o comandă și NU e un refuz
 *   - altfel (1ONB24…, 1ONBLN…) → colet trimis de noi pentru o comandă din magazin
 */
export function samedayAwbKind(awb) {
  const a = String(awb || '').trim().toUpperCase();
  if (a.includes('EMG')) return 'emag';
  if (a.startsWith('1ONBLR')) return 'client_return';
  return 'shop';
}
