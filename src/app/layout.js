export const metadata = {
  title: 'Shanked',
  description: 'AI-powered golf trip roast machine',
  manifest: '/manifest.json',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Shanked" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#0a0a0a', overflowX: 'hidden', width: '100%' }}>{children}</body>
    </html>
  )
}
