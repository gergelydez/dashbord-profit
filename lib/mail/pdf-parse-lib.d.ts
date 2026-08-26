/**
 * @types/pdf-parse only covers the package root ('pdf-parse'), not this
 * subpath — see the comment in parse-meta-invoice.ts for why the subpath
 * import is required instead of the root.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdf(dataBuffer: Buffer, options?: unknown): Promise<{ text: string; numpages: number; numrender: number; info: unknown; metadata: unknown; version: string }>;
  export default pdf;
}
