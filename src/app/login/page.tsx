'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase/client';
import { PRODUCT } from '@/lib/product';
import { LogoMark } from '@/components/Logo';
import { Field, Input, Spinner } from '@/components/ui';
import { ArrowRight } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      if (mode === 'signup') {
        const { error } = await sb().auth.signUp({ email, password });
        if (error) throw error;
        setMsg('Account created. Check your inbox if email confirmation is on, then sign in.');
        setMode('signin');
      } else {
        const { error } = await sb().auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(params.get('next') || '/app');
        router.refresh();
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Something went wrong');
    } finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Link href="/" className="transition-opacity hover:opacity-80"><LogoMark size={42} /></Link>
          <div>
            <h1 className="font-display text-[32px] leading-none tracking-[-0.015em] text-white">
              {mode === 'signin' ? `Welcome back to ${PRODUCT.name}` : `Start with ${PRODUCT.name}`}
            </h1>
            <p className="mt-2 text-[12.5px] text-chrome">
              {mode === 'signin'
                ? 'Your invoices, GST position and clients.'
                : 'Three invoices a month, free, forever. No card.'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="card card-pad space-y-4">
          <Field label="Work email">
            <Input type="email" required autoComplete="email" placeholder="you@company.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" required minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          {err && <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12.5px] text-red-300">{err}</p>}
          {msg && <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-[12.5px] text-emerald-300">{msg}</p>}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner /> : <>{mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></>}
          </button>

          <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setErr(''); }}
            className="w-full text-[12.5px] text-chrome hover:text-white">
            {mode === 'signin' ? 'First time here? Create your account' : 'Already have an account? Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-[11.5px] text-chrome-dark">
          <Link href="/" className="hover:text-chrome">← Back to {PRODUCT.name}</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
