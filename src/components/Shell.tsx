'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, FileText, Users, Package, Receipt, Repeat, Landmark,
  Settings, LogOut, FileSignature, Menu, X, MessageSquare, UsersRound, CreditCard, Plug,
} from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useFilterNav } from '@/lib/list-filters';
import { usePlanState } from '@/lib/hooks';
import { PRODUCT } from '@/lib/product';
import { Wordmark } from './Logo';
import { ToastHost } from './ui';
import ChatBar from './ChatBar';

const NAV = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/chats', label: 'Chats', icon: MessageSquare },
  { href: '/app/invoices', label: 'Invoices', icon: FileText },
  { href: '/app/quotes', label: 'Quotes', icon: FileSignature },
  { href: '/app/clients', label: 'Clients', icon: Users },
  { href: '/app/team', label: 'Team', icon: UsersRound },
  { href: '/app/items', label: 'Services', icon: Package },
  { href: '/app/recurring', label: 'Retainers', icon: Repeat },
  { href: '/app/recurring-expenses', label: 'Subscriptions', icon: CreditCard },
  { href: '/app/expenses', label: 'Expenses', icon: Receipt },
  { href: '/app/gst', label: 'GST & Tax', icon: Landmark },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const navHref = useFilterNav();
  const { plan } = usePlanState();

  useEffect(() => {
    sb().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  const signOut = async () => { await sb().auth.signOut(); router.push('/login'); router.refresh(); };
  const isActive = (href: string) => {
    if (href === '/app') return pathname === '/app';
    if (href === '/app/recurring') return pathname === '/app/recurring';
    return pathname.startsWith(href);
  };
  const hideChat = pathname.startsWith('/app/chats');

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      {/* ---------------- sidebar ---------------- */}
      <aside className={`no-print fixed inset-y-0 left-0 z-50 w-[236px] border-r border-line bg-ink-800/95 backdrop-blur
                         transition-transform lg:static lg:translate-x-0
                         ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-4">
            <Link href="/app"><Wordmark /></Link>
            <button className="btn-subtle btn-xs lg:hidden" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
            <p className="label-mono px-3 pb-1.5 pt-2">Workspace</p>
            {NAV.map((n) => (
              <Link key={n.href} href={navHref[n.href] ?? n.href}
                className={`nav-item ${isActive(n.href) ? 'nav-item-active' : ''}`}>
                <n.icon size={16} strokeWidth={1.6} /> {n.label}
              </Link>
            ))}
            <p className="label-mono px-3 pb-1.5 pt-5">Organisation</p>
            <Link href="/app/integrations" className={`nav-item ${isActive('/app/integrations') ? 'nav-item-active' : ''}`}>
              <Plug size={16} strokeWidth={1.6} /> Integrations
            </Link>
            <Link href="/app/settings" className={`nav-item ${isActive('/app/settings') ? 'nav-item-active' : ''}`}>
              <Settings size={16} strokeWidth={1.6} /> Profile & Settings
            </Link>
          </nav>

          {plan && plan.limit != null && (
            <div className="mx-3 mb-2 rounded-[8px] border border-line bg-ink-700/50 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="label-mono">Free plan</span>
                <span className="font-mono text-[11px] text-chrome-light">{plan.used}/{plan.limit}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-400">
                <div
                  className={`h-full rounded-full transition-all ${plan.left === 0 ? 'bg-amber-400' : 'bg-blue'}`}
                  style={{ width: `${Math.min(100, (plan.used / plan.limit) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[10.5px] leading-snug text-chrome-dark">
                {plan.left === 0
                  ? 'Cap reached. Drafts stay free.'
                  : `${plan.left} invoice${plan.left === 1 ? '' : 's'} left this month`}
              </p>
              <Link href="/#pricing" className="btn-primary btn-xs mt-2 w-full">Upgrade to Pro</Link>
            </div>
          )}

          <div className="border-t border-line px-3 py-3">
            <div className="truncate px-2 text-[11.5px] text-chrome" title={email}>{email || '—'}</div>
            <button onClick={signOut} className="nav-item mt-1 w-full"><LogOut size={16} strokeWidth={1.6} /> Sign out</button>
            <p className="label-mono px-2 pt-2 text-[9px] text-chrome-dark">{PRODUCT.name.toUpperCase()} · ANYTHING IS BUILDABLE</p>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      {/* ---------------- main ---------------- */}
      <div className="min-w-0">
        <div className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink/90 px-4 py-3 backdrop-blur lg:hidden">
          <button className="btn-ghost btn-sm" onClick={() => setOpen(true)}><Menu size={16} /></button>
          <Wordmark compact />
        </div>
        <main className={`mx-auto w-full max-w-[1240px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8 ${hideChat ? 'pb-8' : 'pb-24'}`}>
          {children}
        </main>
      </div>

      <ToastHost />
      {!hideChat && <ChatBar />}
    </div>
  );
}
