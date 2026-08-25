'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const STORE = 'bl:filters:';

export const FILTER_NAV: Record<string, string> = {
  '/invoices': 'invoices',
  '/quotes': 'quotes',
  '/clients': 'clients',
  '/items': 'items',
  '/expenses': 'expenses',
  '/gst': 'gst',
  '/team': 'team',
};

type FilterMap = Record<string, string>;

function readStore(key: string): FilterMap {
  try {
    const raw = sessionStorage.getItem(STORE + key);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: FilterMap = {};
    for (const [k, val] of Object.entries(v as FilterMap)) {
      if (typeof val === 'string') out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(key: string, values: FilterMap) {
  try {
    sessionStorage.setItem(STORE + key, JSON.stringify(values));
    window.dispatchEvent(new Event('bl:filters'));
  } catch { /* private mode */ }
}

function compact(values: FilterMap, defaults: FilterMap): FilterMap {
  const out: FilterMap = {};
  for (const [k, v] of Object.entries(values)) {
    if (v == null || v === '') continue;
    if (v === (defaults[k] ?? '')) continue;
    out[k] = v;
  }
  return out;
}

/** List URL with the last filters for that tab — used by nav and back links. */
export function filtersHref(pathname: string): string {
  const key = FILTER_NAV[pathname];
  if (!key || typeof window === 'undefined') return pathname;
  const qs = new URLSearchParams(readStore(key)).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function useFiltersHref(pathname: string) {
  const hrefs = useFilterNav();
  return hrefs[pathname] ?? pathname;
}

export function useFilterNav() {
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    window.addEventListener('bl:filters', h);
    return () => window.removeEventListener('bl:filters', h);
  }, []);
  const hrefs: Record<string, string> = {};
  for (const path of Object.keys(FILTER_NAV)) hrefs[path] = filtersHref(path);
  return hrefs;
}

/**
 * List filters that survive opening a row and coming back.
 * URL is source of truth when present; otherwise the last session for this tab.
 */
export function useListFilters<T extends FilterMap>(key: string, defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const keys = useMemo(() => Object.keys(defaults), [defaults]);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [values, setValues] = useState<T>(() => {
    const url: FilterMap = {};
    let hasUrl = false;
    keys.forEach((k) => {
      const v = sp.get(k);
      if (v !== null) { url[k] = v; hasUrl = true; }
    });
    if (hasUrl) return { ...defaults, ...url };
    if (typeof window !== 'undefined') return { ...defaults, ...readStore(key) };
    return { ...defaults };
  });

  // Hard refresh lands with empty URL — restore session once, then write it back onto the URL.
  useEffect(() => {
    const hasUrl = keys.some((k) => new URLSearchParams(window.location.search).has(k));
    if (hasUrl) return;
    const stored = readStore(key);
    if (!Object.keys(stored).length) return;
    setValues((prev) => {
      const merged = { ...prev, ...stored };
      return JSON.stringify(merged) === JSON.stringify(prev) ? prev : merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const serial = JSON.stringify(values);

  useEffect(() => {
    const next = JSON.parse(serial) as T;
    const slim = compact(next, defaultsRef.current);
    writeStore(key, slim);
    const current = new URLSearchParams(window.location.search);
    keys.forEach((k) => current.delete(k));
    Object.entries(slim).forEach(([k, v]) => current.set(k, v));
    const qs = current.toString();
    const now = window.location.search.replace(/^\?/, '');
    if (qs === now) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [serial, key, keys, pathname, router]);

  const set = useCallback(<K extends keyof T>(name: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const patch = useCallback((partial: Partial<T>) => {
    setValues((prev) => ({ ...prev, ...partial }));
  }, []);

  return { values, set, patch };
}
