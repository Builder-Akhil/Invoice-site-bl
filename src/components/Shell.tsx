'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, FileText, Users, Package, Receipt, Repeat, Landmark,
  Settings, LogOut, FileSignature, Menu, X, MessageSquare, UsersRound, CreditCard,
} from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { Wordmark } from './Logo';
import { ToastHost } from './ui';
import ChatBar from './ChatBar';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/chats', label: 'Chats', icon: MessageSquare },
  { href: '/invoices', label: 'Invoices', icon: FileText },
  { href: '/quotes', label: 'Quotes', icon: FileSignature },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/team', label: 'Team', icon: UsersRound },
  { href: '/items', label: 'Services', icon: Package },
  { href: '/recurring', label: 'Retainers', icon: Repeat },
  { href: '/recurring-expenses', label: 'Subscriptions', icon: CreditCard },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/gst', label: 'GST & Tax', icon: Landmark },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    sb().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  const signOut = async () => { await sb().auth.signOut(); router.push('/login'); router.refresh(); };
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/recurring') return pathname === '/recurring';
    return pathname.startsWith(href);
  };
  const hideChat = pathname.startsWith('/chats');

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      {/* ---------------- sidebar ---------------- */}
      <aside className={`no-print fixed inset-y-0 left-0 z-50 w-[236px] border-r border-line bg-ink-800/95 backdrop-blur
                         transition-transform lg:static lg:translate-x-0
                         ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-4">
            <Link href="/"><Wordmark /></Link>
            <button className="btn-subtle btn-xs lg:hidden" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
            <p className="label-mono px-3 pb-1.5 pt-2">Workspace</p>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}
                className={`nav-item ${isActive(n.href) ? 'nav-item-active' : ''}`}>
                <n.icon size={16} strokeWidth={1.6} /> {n.label}
              </Link>
            ))}
            <p className="label-mono px-3 pb-1.5 pt-5">Organisation</p>
            <Link href="/settings" className={`nav-item ${isActive('/settings') ? 'nav-item-active' : ''}`}>
              <Settings size={16} strokeWidth={1.6} /> Profile & Settings
            </Link>
          </nav>

          <div className="border-t border-line px-3 py-3">
            <div className="truncate px-2 text-[11.5px] text-chrome" title={email}>{email || '—'}</div>
            <button onClick={signOut} className="nav-item mt-1 w-full"><LogOut size={16} strokeWidth={1.6} /> Sign out</button>
            <p className="label-mono px-2 pt-2 text-[9px] text-chrome-dark">ANYTHING IS BUILDABLE</p>
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
