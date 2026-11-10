import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect, useId, useRef } from 'react';
import type { Conflict } from '../lib/api';

const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean };

export function Button({ variant = 'primary', busy, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
        variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        variant === 'ghost' && 'text-stone-600 hover:bg-stone-100',
        className,
      )}
    >
      {busy ? 'Aguarde…' : children}
    </button>
  );
}

const control = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-stone-100';

/** A labelled control: the label is tied to the input by id (clickable, read by screen readers). */
export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

/** Full width unless the caller sets a width of its own. */
const controlClass = (className?: string, extra?: string) => cx(control, !/(^|\s)w-/.test(className ?? '') && 'w-full', extra, className);

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={controlClass(className)} />;
export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={controlClass(className)} />;
export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={controlClass(className, 'min-h-28')} />;

/** Native <dialog>: focus trap, Esc to close and a backdrop for free. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cx('m-auto w-full rounded-2xl p-0 shadow-xl backdrop:bg-stone-900/40', wide ? 'max-w-2xl' : 'max-w-lg')}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Fechar">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'warning' | 'info' | 'success'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
      )}
    >
      {children}
    </div>
  );
}

const REASON: Record<string, string> = {
  psychologist: 'psicólogo ocupado',
  room: 'sala ocupada',
  patient: 'paciente em outra sessão',
  working_hours: 'fora do horário de trabalho',
  time_off: 'ausência do psicólogo',
  past: 'data passada',
};

/** The API's 409 detail: what is in the way, date by date for a series. */
export function ConflictList({ conflicts, timeZone }: { conflicts: Conflict[]; timeZone: string }) {
  if (!conflicts.length) return null;
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {conflicts.map((c, i) => (
        <li key={i} className="flex justify-between gap-3 rounded bg-white/60 px-2 py-1">
          <span>{fmt.format(new Date(c.startsAt))}</span>
          <span className="font-medium">{REASON[c.reason] ?? c.reason}</span>
        </li>
      ))}
    </ul>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('rounded-2xl border border-stone-200 bg-white p-5 shadow-xs', className)}>{children}</div>
);

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="py-8 text-center text-sm text-stone-500">{children}</p>;
