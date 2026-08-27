import type { Metadata, Viewport } from 'next';
import { PRODUCT } from '@/lib/product';
import './globals.css';

/**
 * Root metadata is the *marketing* identity, because '/' is the landing page
 * and that is what crawlers, LLMs and link unfurlers see. The signed-in product
 * overrides the title in src/app/app/layout.tsx.
 */
export const metadata: Metadata = {
  metadataBase: new URL(PRODUCT.url),
  title: {
    default: `${PRODUCT.name} — ${PRODUCT.tagline}`,
    template: `%s · ${PRODUCT.name}`,
  },
  description: PRODUCT.blurb,
  applicationName: PRODUCT.name,
  authors: [{ name: PRODUCT.founder }],
  creator: PRODUCT.founder,
  publisher: PRODUCT.legalOwner,
  category: 'Business software',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  icons: {
    icon: [{ url: '/buildable-labs-payment-logo.png', type: 'image/png' }],
    shortcut: '/buildable-labs-payment-logo.png',
    apple: '/buildable-labs-payment-logo.png',
  },
  other: {
    // Read by several AI crawlers looking for a machine-readable product brief.
    'ai-content-declaration': `${PRODUCT.url}/llms.txt`,
  },
};

export const viewport: Viewport = {
  themeColor: '#0A0B0E',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap"
        />
        <link rel="icon" href="/buildable-labs-payment-logo.png" type="image/png" />
        <link rel="apple-touch-icon" href="/buildable-labs-payment-logo.png" />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM-readable product brief" />
      </head>
      <body>{children}</body>
    </html>
  );
}
