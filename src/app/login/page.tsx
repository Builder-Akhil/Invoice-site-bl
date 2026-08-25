'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { sb } from '@/lib/supabase/client';
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
        router.push(params.get('next') || '/');
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
          <LogoMark size={44} />
          <div>
            <h1 className="font-display text-[34px] leading-none text-white">Buildable Labs</h1>
            <p className="label-mono mt-2">BILLING &amp; GST PORTAL · LLP</p>
          </div>
        </div>

        <form onSubmit={submit} className="card card-pad space-y-4">
          <Field label="Work email">
            <Input type="email" required autoComplete="email" placeholder="akhil@buildablelabs.com"
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

        <p className="mt-6 text-center text-[11px] leading-relaxed text-chrome-dark">
          Team access is managed in Supabase → Authentication → Users.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
