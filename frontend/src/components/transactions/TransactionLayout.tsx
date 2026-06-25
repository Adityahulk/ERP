import { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TransactionPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('mx-auto w-full max-w-[1440px] px-4 sm:px-6 py-4 sm:py-6 space-y-5', className)}>{children}</div>;
}

export function TransactionHeader({
  title,
  description,
  left,
  actions,
}: {
  title: string;
  description?: string;
  left?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {left}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TransactionGrid({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-5">{children}</div>
      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">{sidebar}</aside>
    </div>
  );
}

export function TransactionSection({
  title,
  description,
  actions,
  children,
  compact = false,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md', className)}>
      <div className={cn('flex items-start justify-between gap-3 border-b', compact ? 'px-4 py-2.5' : 'px-5 py-3.5')}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className={cn(compact ? 'p-4' : 'p-5')}>{children}</div>
    </section>
  );
}

export function CollapsibleTransactionSection({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-semibold hover:bg-muted/30 transition-colors rounded-xl"
        onClick={() => onOpenChange(!open)}
      >
        {title}
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-in-out',
          open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="border-t p-5">{children}</div>
      </div>
    </section>
  );
}

export function StickySummaryCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border bg-muted/40 p-5 shadow-md">{children}</div>;
}

export function MobileActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur xl:hidden">
      <div className="flex flex-wrap justify-end gap-2">{children}</div>
    </div>
  );
}
