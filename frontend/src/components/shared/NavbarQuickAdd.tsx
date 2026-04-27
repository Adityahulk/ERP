import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type QuickLink = { label: string; to: string; kbd?: string };

const SALE_LINKS: QuickLink[] = [
  { label: 'Sale invoice', to: '/sales/new', kbd: '⌥ S' },
  { label: 'POS / Quick bill', to: '/billing', kbd: '⌥ B' },
  { label: 'Estimate / quotation', to: '/quotations/new', kbd: '⌥ M' },
  { label: 'Sale order (quote)', to: '/quotations/new', kbd: '⌥ F' },
];

const PURCHASE_LINKS: QuickLink[] = [
  { label: 'Purchase order', to: '/purchases/new', kbd: '⌥ P' },
  { label: 'Receive stock (GRN)', to: '/purchases', kbd: '⌥ G' },
  { label: 'Purchase list', to: '/purchases', kbd: '⌥ L' },
];

const OTHER_LINKS: QuickLink[] = [
  { label: 'Expense', to: '/expenses?add=1', kbd: '⌥ E' },
  { label: 'Stock transfer', to: '/inventory/transfer', kbd: '⌥ T' },
  { label: 'Stock adjustment', to: '/inventory/adjust', kbd: '⌥ A' },
  { label: 'Parties', to: '/parties', kbd: '⌥ J' },
  { label: 'Accounting', to: '/accounting', kbd: '⌥ I' },
];

const MANUFACTURING_LINKS: QuickLink[] = [
  { label: 'Wholesale order', to: '/wholesale/new', kbd: '⌥ W' },
  { label: 'Job work challan', to: '/job-work/new', kbd: '⌥ K' },
  { label: 'New BOM', to: '/production/new', kbd: '⌥ D' },
  { label: 'Pricing tiers', to: '/wholesale/pricing', kbd: '⌥ R' },
];

function LinkColumn({ title, links, onPick }: { title: string; links: QuickLink[]; onPick: (to: string) => void }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">{title}</h3>
      <ul className="space-y-0.5">
        {links.map((l) => (
          <li key={l.label}>
            <button
              type="button"
              onClick={() => onPick(l.to)}
              className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-md hover:bg-slate-50 text-left text-sm text-slate-800 group"
            >
              <span className="flex items-center gap-2 min-w-0">
                <ChevronRight className="w-3.5 h-3.5 text-sky-600 shrink-0 opacity-80 group-hover:opacity-100" />
                <span className="truncate">{l.label}</span>
              </span>
              {l.kbd ? (
                <kbd className="shrink-0 text-[10px] text-slate-400 font-mono hidden sm:inline">{l.kbd}</kbd>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NavbarQuickAdd() {
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const go = (to: string) => {
    navigate(to);
    setMoreOpen(false);
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        setMoreOpen((o) => !o);
        return;
      }
      if (!e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      const map: Record<string, string> = {
        s: '/sales/new',
        b: '/billing',
        m: '/quotations/new',
        f: '/quotations/new',
        p: '/purchases/new',
        g: '/purchases',
        l: '/purchases',
        e: '/expenses?add=1',
        t: '/inventory/transfer',
        a: '/inventory/adjust',
        j: '/parties',
        i: '/accounting',
        w: '/wholesale/new',
        k: '/job-work/new',
        d: '/production/new',
        r: '/wholesale/pricing',
      };
      if (map[k]) {
        e.preventDefault();
        navigate(map[k]);
        setMoreOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <Button
          type="button"
          size="sm"
          className="h-9 font-semibold shadow-sm bg-rose-600 hover:bg-rose-700 text-white border-0"
          onClick={() => go('/sales/new')}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Sale
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-9 font-semibold shadow-sm bg-sky-500 hover:bg-sky-600 text-white border-0"
          onClick={() => go('/purchases/new')}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Purchase
        </Button>
        <div className="relative" ref={panelRef}>
          <Button
            type="button"
            size="sm"
            className={cn(
              'h-9 font-semibold shadow-sm bg-blue-600 hover:bg-blue-700 text-white border-0',
              moreOpen && 'ring-2 ring-blue-300 ring-offset-1'
            )}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add More
          </Button>
          {moreOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] w-[min(92vw,720px)] rounded-xl border border-slate-200 bg-white shadow-2xl z-[60] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-0 sm:divide-x divide-slate-100 p-4 sm:p-5">
                <LinkColumn title="Sale" links={SALE_LINKS} onPick={go} />
                <LinkColumn title="Purchase" links={PURCHASE_LINKS} onPick={go} />
                <LinkColumn title="Manufacturing" links={MANUFACTURING_LINKS} onPick={go} />
                <LinkColumn title="Others" links={OTHER_LINKS} onPick={go} />
              </div>
              <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2">
                <span>
                  Open this menu: <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-200">⌘ Enter</kbd> or{' '}
                  <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-200">Ctrl Enter</kbd>
                </span>
                <span className="text-amber-800/80 hidden sm:inline">Alt + letter jumps to a screen</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile */}
      <div className="flex md:hidden items-center gap-1 shrink-0">
        <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-rose-700 border-rose-200" onClick={() => go('/sales/new')}>
          Sale
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-sky-700 border-sky-200" onClick={() => go('/purchases/new')}>
          Buy
        </Button>
        <Button type="button" size="sm" className="h-8 px-2 bg-blue-600 text-white" onClick={() => setMobileMenuOpen(true)}>
          More
        </Button>
      </div>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Quick add</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-6 overflow-y-auto pb-8">
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Sale</h3>
              <div className="grid grid-cols-2 gap-2">
                {SALE_LINKS.map((l) => (
                  <Button key={l.label} variant="outline" className="h-auto py-3 justify-start text-left text-sm" onClick={() => go(l.to)}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Purchase</h3>
              <div className="grid grid-cols-2 gap-2">
                {PURCHASE_LINKS.map((l) => (
                  <Button key={l.label} variant="outline" className="h-auto py-3 justify-start text-left text-sm" onClick={() => go(l.to)}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Manufacturing</h3>
              <div className="grid grid-cols-2 gap-2">
                {MANUFACTURING_LINKS.map((l) => (
                  <Button key={l.label} variant="outline" className="h-auto py-3 justify-start text-left text-sm" onClick={() => go(l.to)}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Others</h3>
              <div className="grid grid-cols-2 gap-2">
                {OTHER_LINKS.map((l) => (
                  <Button key={l.label} variant="outline" className="h-auto py-3 justify-start text-left text-sm" onClick={() => go(l.to)}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
