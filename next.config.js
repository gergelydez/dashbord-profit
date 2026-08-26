/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdfjs-dist (lib/mail/pdf-text.ts) optionally `require`s the native
    // `canvas` package inside a try/catch, only used for page.render() to
    // an image — never called here, text extraction alone doesn't need it.
    // Webpack still tries to statically resolve it at build time though,
    // so it has to be aliased away explicitly (the standard fix for
    // pdfjs-dist + webpack/Next.js).
    config.resolve.alias.canvas = false;
    return config;
  },
  async headers() {
    return [
      {
        // HTML pages — nu se caching-uiesc niciodată
        source: '/((?!_next/static|_next/image|favicon|icon|manifest|screenshot).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
