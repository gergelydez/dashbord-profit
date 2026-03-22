export const metadata = {
  title: 'GLAMX Dashboard',
  description: 'Dashboard comenzi Shopify',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  )
}
