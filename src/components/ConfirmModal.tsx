import { useEffect, useRef } from 'react';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'warning' | 'danger';
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'warning',
  confirmDisabled = false,
  cancelDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !cancelDisabled) {
        onCancel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [cancelDisabled, onCancel, open]);

  if (!open) {
    return null;
  }

  const isDanger = variant === 'danger';

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!cancelDisabled) {
          onCancel();
        }
      }}
    >
      <div
        className="modal-dialog"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`modal-icon ${isDanger ? 'modal-icon-danger' : 'modal-icon-warning'}`}>
          {isDanger ? '⚠' : 'ℹ'}
        </div>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={cancelDisabled}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
