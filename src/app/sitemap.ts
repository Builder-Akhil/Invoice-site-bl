import type { MetadataRoute } from 'next';
import { PRODUCT } from '@/lib/product';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: PRODUCT.url, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${PRODUCT.url}/#pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${PRODUCT.url}/#gst`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${PRODUCT.url}/#faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${PRODUCT.url}/#channels`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
  ];
}
