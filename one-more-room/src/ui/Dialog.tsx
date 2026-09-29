import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A modal dialog: blocks the board underneath, traps Tab focus, closes on
 * Escape, and hands focus back to whatever had it before.
 */
export function Dialog({ title, onClose, children, wide = false, labelledBy }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    (focusables()[0] ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && close.current) {
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  const id = labelledBy ?? `dlg-${title.replace(/\W+/g, '-')}`;
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={id}>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export function CandyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="candy-icon">
      <path d="M3 7l4 2-1 3 1 3-4 2 1-5z" fill="#ff8fb8" />
      <path d="M21 7l-4 2 1 3-1 3 4 2-1-5z" fill="#ff8fb8" />
      <ellipse cx="12" cy="12" rx="6" ry="4.6" fill="#ff4d6d" />
      <path d="M8.5 9.5c2 1 5 1 7 0M8.5 14.5c2-1 5-1 7 0" stroke="#ffd1dc" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

export function PlayerBadge({ n, color, size = 26 }: { n: number; color: string; size?: number }) {
  return (
    <span className="badge" style={{ background: color, width: size, height: size, fontSize: size * 0.55 }} aria-hidden="true">
      {n}
    </span>
  );
}
