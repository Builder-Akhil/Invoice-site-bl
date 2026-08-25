export interface SacCode {
  code: string;
  /** Short chip / dropdown tag, e.g. Advisory */
  tag: string;
  /** Full SAC description */
  label: string;
}

export const DEFAULT_SAC_CODES: SacCode[] = [
  { code: '998313', tag: 'Advisory', label: 'IT consulting & advisory' },
  { code: '998314', tag: 'IT design', label: 'IT design & development' },
  { code: '999293', tag: 'Training', label: 'Training & coaching' },
];

export function sacOptionLabel(s: SacCode) {
  return `${s.code} · ${s.tag}`;
}

/** Extra phrases for the built-in three — GST wording plus how people actually describe the work. */
const BUILTIN_HINTS: Record<string, string[]> = {
  '998313': [
    'advisory', 'consulting', 'consultant', 'consultation', 'consult',
    'cto', 'strategy', 'advise', 'advisor', 'it consulting',
  ],
  '998314': [
    'it design', 'design and development', 'development', 'software',
    'website', 'web app', 'application', 'engineering', 'engineer',
    'product', 'saas', 'full stack', 'frontend', 'backend', 'mobile app', 'app',
  ],
  '999293': [
    'training', 'coaching', 'workshop', 'course', 'mentor', 'mentoring',
    'teaching', 'upskill', 'commercial training',
  ],
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasPhrase(hay: string, needle: string) {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  if (n.includes(' ')) return hay.includes(n);
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(n)}(?:$|[^a-z0-9])`).test(hay);
}

/** Pick the tagged SAC that best matches a line name / description. */
export function matchSacCode(text: string, codes: SacCode[] = DEFAULT_SAC_CODES): SacCode | null {
  const hay = ` ${text.toLowerCase()} `;
  let best: { sac: SacCode; score: number } | null = null;
  for (const s of codes) {
    let score = 0;
    if (s.code && hay.includes(s.code.toLowerCase())) score += 100;
    if (hasPhrase(hay, s.tag)) score += 50;
    if (s.label && hay.includes(s.label.toLowerCase())) score += 40;
    for (const part of s.tag.toLowerCase().split(/\s+/)) {
      if (part.length >= 4 && hasPhrase(hay, part)) score += 15;
    }
    for (const part of s.label.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 5 && hasPhrase(hay, part)) score += 12;
    }
    for (const hint of BUILTIN_HINTS[s.code] ?? []) {
      if (hasPhrase(hay, hint)) score += 25;
    }
    if (score > 0 && (!best || score > best.score)) best = { sac: s, score };
  }
  return best && best.score >= 25 ? best.sac : null;
}

/** Chat / draft: prefer a text match on the tagged list, then a valid provided code, then fallback. */
export function resolveLineSac(opts: {
  name?: string | null;
  description?: string | null;
  code?: string | null;
  codeType?: string | null;
  fallback?: string | null;
  codes?: unknown;
}): string | null {
  if ((opts.codeType ?? 'SAC').toUpperCase() === 'HSN') {
    return (opts.code ?? '').replace(/\s/g, '') || opts.fallback || null;
  }
  const list = resolveSacCodes(opts.codes);
  const inList = (code?: string | null) => !!code && list.some((s) => s.code === code);
  const provided = (opts.code ?? '').replace(/\s/g, '') || null;
  const matched = matchSacCode(`${opts.name ?? ''} ${opts.description ?? ''}`, list);
  if (matched) return matched.code;
  if (inList(provided)) return provided;
  if (inList(opts.fallback)) return opts.fallback ?? null;
  if (provided) return provided;
  return opts.fallback || list[0]?.code || null;
}

function asText(v: unknown) {
  return typeof v === 'string' ? v.trim() : '';
}

/** Built-in list, unless Settings saved a custom one. */
export function resolveSacCodes(raw: unknown): SacCode[] {
  if (!Array.isArray(raw)) return DEFAULT_SAC_CODES.map((s) => ({ ...s }));
  const clean: SacCode[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const code = asText(rec.code).replace(/\s/g, '');
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const label = asText(rec.label) || asText(rec.tag) || code;
    const tag = asText(rec.tag) || label.split(/\s+/)[0] || code;
    clean.push({ code, tag, label });
  }
  return clean.length ? clean : DEFAULT_SAC_CODES.map((s) => ({ ...s }));
}
