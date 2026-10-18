import { useEffect, useRef, useState, useId } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = '',
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  const [present, setPresent] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = setTimeout(() => setPresent(false), 180);
    return () => clearTimeout(timer);
  }, [open]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!present || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const timer = setTimeout(() => {
      const target = node?.querySelector<HTMLElement>(
        '[autofocus],button:not([disabled]),input,textarea,select,[tabindex="0"]',
      );
      (target ?? node)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role=dialog]');
      if (dialogs[dialogs.length - 1] !== node) return;
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab' && node) {
        const elements = [
          ...node.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length > 0);
        if (!elements.length) {
          e.preventDefault();
          node.focus();
          return;
        }
        const first = elements[0],
          last = elements.at(-1)!;
        if (
          e.shiftKey &&
          (document.activeElement === first || !node.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !node.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [present, open]);
  if (!present) return null;
  return createPortal(
    <div
      className={`dialog-overlay ${open ? 'is-open' : 'is-closing'}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`dialog ${className}`}
      >
        <header className="dialog-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId}>{description}</p>}
          </div>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function ConfirmDialog({
  open,
  title,
  description,
  onClose,
  onConfirm,
  danger = false,
  confirmText = '确认',
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  confirmText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) setError('');
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      className="confirm-dialog"
      busy={busy}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <button className="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className={`button ${danger ? 'button-danger' : 'button-primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '处理中…' : confirmText}
        </button>
      </footer>
    </Dialog>
  );
}
