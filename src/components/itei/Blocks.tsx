// Small ITEI building blocks: Card, Notice, KpiTile, Field.
import type { ReactNode } from 'react';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

export function Card({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('border border-border bg-surface-raised', className)}>
      {title ? (
        <header className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base leading-6 font-bold tracking-[0.02em] text-brand-navy">{title}</h2>
          {meta ? <span className="text-xs leading-4 text-ink-muted">{meta}</span> : null}
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

type NoticeTone = 'error' | 'warning' | 'info' | 'success';

const NOTICE_STYLE: Record<NoticeTone, { box: string; Icon: typeof IconInfoCircle }> = {
  error: { box: 'bg-danger-bg text-brand-red', Icon: IconCircleX },
  warning: { box: 'bg-warning-bg text-warning', Icon: IconAlertTriangle },
  info: { box: 'bg-info-bg text-link', Icon: IconInfoCircle },
  success: { box: 'bg-success-bg text-success', Icon: IconCircleCheck },
};

/** Status line. Errors carry the word “错误” because ITEI red also means “current item”. */
export function Notice({ tone, children, className }: { tone: NoticeTone; children: ReactNode; className?: string }) {
  const { box, Icon } = NOTICE_STYLE[tone];
  return (
    <p aria-live="polite" className={cn('flex items-start gap-2 px-3 py-2 text-[13px] leading-5', box, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" stroke={2} />
      <span>
        {tone === 'error' ? <span className="font-semibold">错误：</span> : null}
        {children}
      </span>
    </p>
  );
}

export function KpiTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <article className="flex flex-col gap-1 border border-border bg-surface-raised p-4">
      <span className="text-[13px] leading-5 text-ink-muted">{label}</span>
      <strong className="text-[28px] leading-8 font-bold tracking-[-0.01em] text-brand-navy tabular-nums">{value}</strong>
    </article>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] leading-4 font-semibold tracking-[0.02em] text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Second-level section title: navy text with a sky underline that follows the text width. */
export function SubTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="w-fit border-b-2 border-brand-sky pb-1 text-lg leading-[26px] font-bold text-ink">{children}</h3>
  );
}
