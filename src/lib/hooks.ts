'use client';
import { useCallback, useEffect, useState } from 'react';
import { sb } from './supabase/client';
import { planById, type PlanId } from './product';
import type { CatalogItem, Client, CompanyProfile } from './types';

export function useProfile() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await sb().from('company_profile').select('*').eq('id', 1).single();
    setProfile(data as CompanyProfile | null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { profile, loading, reload: load };
}

export function useClients(activeOnly = false) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    let q = sb().from('clients').select('*').order('company_name');
    if (activeOnly) q = q.eq('status', 'active');
    const { data } = await q;
    setClients((data ?? []) as Client[]);
    setLoading(false);
  }, [activeOnly]);
  useEffect(() => { load(); }, [load]);
  return { clients, loading, reload: load };
}

export function useItems() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await sb().from('items').select('*').order('name');
    setItems((data ?? []) as CatalogItem[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, loading, reload: load };
}

/** Generic list loader for the simpler tables. */
export function useRows<T>(table: string, orderBy: string, ascending = false) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb().from(table).select('*').order(orderBy, { ascending });
    setRows((data ?? []) as T[]);
    setLoading(false);
  }, [table, orderBy, ascending]);
  useEffect(() => { load(); }, [load]);
  return { rows, loading, reload: load, setRows };
}

export type PlanState = {
  plan: PlanId;
  used: number;
  /** null = unlimited */
  limit: number | null;
  left: number | null;
};

/**
 * The free-plan meter. Read from the browser rather than the server route
 * because the numbers behind it (profile plan, issued invoices) are already
 * readable under RLS — no secrets involved.
 */
export function usePlanState() {
  const [state, setState] = useState<PlanState | null>(null);
  const load = useCallback(async () => {
    const { data: profile } = await sb().from('company_profile').select('plan').eq('id', 1).maybeSingle();
    const raw = (profile as { plan?: string } | null)?.plan;
    const plan: PlanId = raw === 'pro' || raw === 'byo' ? raw : 'free';
    const limit = planById(plan).invoicesPerMonth;
    if (limit == null) return setState({ plan, used: 0, limit: null, left: null });

    const from = new Date();
    from.setDate(1);
    const { count } = await sb().from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('doc_type', 'invoice')
      .not('status', 'in', '("draft","cancelled")')
      .gte('invoice_date', from.toISOString().slice(0, 10));
    const used = count ?? 0;
    setState({ plan, used, limit, left: Math.max(0, limit - used) });
  }, []);
  useEffect(() => { load(); }, [load]);
  return { plan: state, reload: load };
}
