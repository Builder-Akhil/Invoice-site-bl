import type { Metadata } from 'next';
import Shell from '@/components/Shell';
import { PRODUCT } from '@/lib/product';

/** The signed-in product is never indexed — it is behind auth and has no SEO value. */
export const metadata: Metadata = {
  title: { default: `Dashboard · ${PRODUCT.name}`, template: `%s · ${PRODUCT.name}` },
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
