// ITEI page skeleton: AppHeader, NumberedNav step bar, Footer. See design/itei/components.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function AppHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <>
      <header className="flex h-[var(--header-height)] items-stretch overflow-hidden bg-itei-header text-on-gradient" role="banner">
        <div className="clip-slash flex items-center gap-3 bg-on-gradient pr-[calc(24px+var(--slash))] pl-6">
          <img src="/itei-logo.png" alt="ITEI" className="h-7 w-auto" />
        </div>
        <h1 className="flex flex-1 items-center px-6 text-xl leading-7 font-bold">{title}</h1>
        {actions ? <div className="flex items-center gap-4 px-6">{actions}</div> : null}
      </header>
      <div className="h-0.5 bg-brand-sky" />
    </>
  );
}

export interface StepItem {
  key: string;
  label: string;
  current: boolean;
  done: boolean;
  disabled: boolean;
}

/** Horizontal NumberedNav: numbered block + label bar; current step red, done steps light. */
export function StepNav({ items, onSelect }: { items: StepItem[]; onSelect: (key: string) => void }) {
  return (
    <nav aria-label="流程步骤" className="mx-auto w-full max-w-[var(--content-max)] px-8 pt-6">
      <ol className="grid grid-cols-4 gap-3">
        {items.map((item, index) => (
          <li key={item.key}>
            <button
              type="button"
              disabled={item.disabled}
              aria-current={item.current ? 'step' : undefined}
              onClick={() => onSelect(item.key)}
              className={cn(
                'group flex h-11 w-full items-stretch text-left transition-colors duration-150 ease-out disabled:cursor-not-allowed',
                item.current && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'clip-slash flex w-[72px] shrink-0 items-center justify-center rounded-l-full pr-3 text-[22px] leading-none font-bold tracking-[-0.01em]',
                  item.current
                    ? 'bg-brand-red text-on-brand'
                    : item.done
                      ? 'bg-info-bg text-brand-navy'
                      : item.disabled
                        ? 'bg-surface-sunken text-ink-disabled'
                        : 'bg-brand-navy text-on-brand',
                )}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span
                className={cn(
                  '-ml-2 flex flex-1 items-center justify-center text-base leading-6 font-bold tracking-[0.02em]',
                  item.current
                    ? 'bg-brand-red text-on-brand'
                    : item.done
                      ? 'bg-info-bg text-brand-navy group-hover:underline'
                      : item.disabled
                        ? 'bg-surface-sunken text-ink-disabled'
                        : 'bg-brand-navy text-on-brand group-hover:bg-brand-navy-deep',
                )}
              >
                {item.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AppFooter() {
  return (
    <footer className="relative mt-12 flex h-10 items-center overflow-hidden bg-header-end px-8 text-xs leading-4 text-on-gradient">
      <span className="flex-1">ITEISlides</span>
      <span className="flex-1 text-center">机械工业仪器仪表综合技术经济研究所（ITEI）</span>
      <span className="flex-1 pr-24 text-right">智能汇报 PPT 生成</span>
      <span aria-hidden="true" className="absolute top-0 right-0 flex h-full w-[120px]">
        <span className="clip-slash h-full w-1/2 bg-brand-sky" />
        <span className="h-full w-1/2 bg-header-start" />
      </span>
    </footer>
  );
}
