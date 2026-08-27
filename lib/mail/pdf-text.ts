/**
 * lib/mail/pdf-text.ts
 * Plain-text extraction from a PDF buffer, using pdfjs-dist directly
 * instead of the pdf-parse package.
 *
 * pdf-parse@1.1.1 bundles an ancient pdf.js build (v1.10.100, from ~2017)
 * that throws hard parse errors on PDFs whose cross-reference table is
 * technically non-compliant but still opens fine in every real viewer —
 * confirmed live: a genuine SmartBill-exported NIR PDF failed with "bad
 * XRef entry" and got wrongly written off as "probably a scanned PDF"
 * before the real error was actually read. Every modern PDF viewer
 * (Chrome, Adobe, phone viewers) recovers from this kind of malformed
 * xref by falling back to scanning the file for objects; modern pdf.js
 * has that same fallback recovery built in, the 2017 bundled version
 * doesn't — confirmed locally against pdf-parse's own bundled test PDFs.
 *
 * Deliberately still avoids the native `canvas` dependency that made
 * pdf-parse v2 risky for Vercel's serverless runtime: getTextContent()
 * never touches canvas (that's only needed for page.render() to an
 * image, which this never calls) — confirmed locally, text extraction
 * works with only a harmless console warning about not being able to
 * polyfill DOMMatrix/Path2D, no thrown error.
 *
 * Joins text items the same way pdf-parse's own renderer did (items on
 * the same line — same Y transform — get concatenated with no separator;
 * a Y change starts a new line) so callers written against pdf-parse's
 * line-based output (lib/mail/parse-meta-invoice.ts) keep working
 * unchanged.
 *
 * Node has no real Worker threads for pdf.js to hand parsing off to, so it
 * falls back to a "fake worker" that just does `require(this.workerSrc)`
 * — and the default workerSrc is a path like "./pdf.worker.js", relative
 * to wherever pdf.js itself happens to live. Confirmed live on Vercel:
 * once webpack bundles everything into unrelated chunk files, that
 * relative path doesn't exist anymore ("Cannot find module
 * './pdf.worker.js'"). Statically importing the worker module ourselves
 * (so webpack bundles it as a real dependency, not a string pdf.js tries
 * to require() dynamically at runtime) and registering it on
 * `globalThis.pdfjsWorker` sidesteps that lookup entirely — pdf.js checks
 * for exactly that global before ever trying to require() anything.
 */
import * as pdfjsWorkerEntry from 'pdfjs-dist/legacy/build/pdf.worker.js';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.js');

let pdfjsLib: PdfjsModule | null = null;
async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
    (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorkerEntry;
  }
  return pdfjsLib;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    for (const item of content.items as Array<{ str?: string; transform: number[] }>) {
      if (typeof item.str !== 'string') continue;
      if (lastY === null || lastY === item.transform[5]) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = item.transform[5];
    }
    text += '\n';
  }
  return text;
}
