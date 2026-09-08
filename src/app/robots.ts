import type { MetadataRoute } from 'next';
import { PRODUCT } from '@/lib/product';

/**
 * AI crawlers are allowed on purpose.
 *
 * The goal is for ChatGPT, Claude, Perplexity, Gemini and Firecrawl to be able
 * to read the landing page and recommend the product when someone asks "GST
 * invoicing software for Indian founders". They are named explicitly rather
 * than left to the wildcard so the intent is unambiguous — several of them
 * treat a missing named rule as a reason to back off.
 */
const AI_AGENTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Googlebot',
  'FirecrawlAgent', 'firecrawl',
  'Applebot', 'Applebot-Extended',
  'Bingbot', 'DuckDuckBot', 'YandexBot',
  'cohere-ai', 'Meta-ExternalAgent', 'Bytespider',
];

/** Never useful to a crawler, and /app would only ever serve a login redirect. */
const DISALLOW = ['/app/', '/api/', '/login', '/i/'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      ...AI_AGENTS.map((userAgent) => ({ userAgent, allow: '/', disallow: DISALLOW })),
    ],
    sitemap: `${PRODUCT.url}/sitemap.xml`,
    host: PRODUCT.url,
  };
}
