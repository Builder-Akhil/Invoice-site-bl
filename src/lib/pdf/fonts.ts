import { join } from 'node:path';
import { Font } from '@react-pdf/renderer';

/**
 * Preview uses Manrope. Built-in Helvetica has no ₹ and draws a stray "1" under
 * the amount (the ghost behind 2,00,600). Static Manrope TTFs are instantiated
 * from the official variable font so ₹ and weights match the on-screen invoice.
 */
let registered = false;

export function registerPdfFonts() {
  if (registered) return;
  registered = true;
  const dir = join(process.cwd(), 'public', 'fonts');

  Font.register({
    family: 'Manrope',
    fonts: [
      { src: join(dir, 'Manrope-Regular.ttf'), fontWeight: 400 },
      { src: join(dir, 'Manrope-Medium.ttf'), fontWeight: 500 },
      { src: join(dir, 'Manrope-SemiBold.ttf'), fontWeight: 600 },
      { src: join(dir, 'Manrope-Bold.ttf'), fontWeight: 700 },
      { src: join(dir, 'Manrope-ExtraBold.ttf'), fontWeight: 800 },
    ],
  });
}

export const PDF_SANS = 'Manrope';
