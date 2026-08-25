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
