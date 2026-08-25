import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Buildable Labs — Billing',
  description: 'Invoicing, GST compliance and revenue for BuildableLabs LLP.',
  icons: {
    icon: [{ url: '/buildable-labs-payment-logo.png', type: 'image/png' }],
    shortcut: '/buildable-labs-payment-logo.png',
    apple: '/buildable-labs-payment-logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap"
        />
        <link rel="icon" href="/buildable-labs-payment-logo.png" type="image/png" />
        <link rel="apple-touch-icon" href="/buildable-labs-payment-logo.png" />
        <meta name="theme-color" content="#0A0B0E" />
      </head>
      <body>{children}</body>
    </html>
  );
}
