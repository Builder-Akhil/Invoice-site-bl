'use client';
import { createBrowserClient } from '@supabase/ssr';

export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

let _sb: ReturnType<typeof createClient> | null = null;
/** Shared browser client. */
export const sb = () => (_sb ??= createClient());
