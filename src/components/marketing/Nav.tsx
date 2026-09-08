'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { PRODUCT } from '@/lib/product';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#gst', label: 'GST' },
  { href: '#channels', label: 'WhatsApp' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const h = () => setSolid(window.scrollY > 12);
    h();
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  return (
    <header className={`sticky top-0 z-50 border-b transition-colors ${
      solid ? 'border-line bg-ink/90 backdrop-blur' : 'border-transparent'}`}>
      <div className="mk-section flex h-[58px] items-center gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <LogoMark size={26} />
          <span className="text-[15px] font-extrabold tracking-tight text-white">{PRODUCT.name}</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}
              className="rounded-[6px] px-2.5 py-1.5 text-[13px] font-medium text-chrome transition hover:bg-ink-600/60 hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className="btn-subtle btn-sm hidden sm:inline-flex">Sign in</Link>
          <Link href="/login" className="btn-primary btn-sm">Start free</Link>
          <button className="btn-subtle btn-sm md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-ink/95 backdrop-blur md:hidden">
          <nav className="mk-section flex flex-col py-2">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}
                className="rounded-[6px] px-2 py-2.5 text-[14px] font-medium text-chrome-light hover:text-white">
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
