import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { Geist, Geist_Mono } from 'next/font/google'
import { PRODUCT, resolveVersion } from '@/lib/product'
import './globals.css'

const sans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
})

const mono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: PRODUCT.name,
  description: PRODUCT.tagline,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

const NAV = [
  { href: '/', label: 'Report' },
  { href: '/register', label: 'Register' },
  { href: '/surfaces', label: 'Surfaces' },
  { href: '/health', label: 'Health' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <div className="shell">
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                {PRODUCT.name}
                <span>v{resolveVersion()}</span>
              </Link>
              <nav className="site-nav" aria-label="Main">
                {NAV.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main>
            <div className="container">{children}</div>
          </main>

          <footer className="site-footer">
            <div className="container">
              <span>
                {PRODUCT.name} v{resolveVersion()} â€” MIT. Deterministic core, no model in the verdict path.
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
