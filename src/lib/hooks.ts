'use client';
import { useCallback, useEffect, useState } from 'react';
import { sb } from './supabase/client';
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
