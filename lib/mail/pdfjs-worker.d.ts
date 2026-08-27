/**
 * pdfjs-dist doesn't ship type declarations for this worker subpath (only
 * the main 'pdfjs-dist' entry is typed) — see lib/mail/pdf-text.ts for why
 * it's imported directly instead of letting pdf.js require() it at runtime.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.js';
