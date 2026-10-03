import { useRef } from 'react';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

// Stays open (both buttons disabled) while the confirmed action runs; Esc / overlay click cancel only when idle.
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
  // Keep the last copy on screen while the dialog fades out after `open` turns false.
  const shownRef = useRef({ title, message, confirmText, cancelText, variant });
  if (open) {
    shownRef.current = { title, message, confirmText, cancelText, variant };
  }
  const shown = shownRef.current;
  const isDanger = shown.variant === 'danger';
  const Icon = isDanger ? IconAlertTriangle : IconInfoCircle;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !cancelDisabled) {
          onCancel();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader className="flex-row items-start gap-3">
          <Icon aria-hidden="true" className={isDanger ? 'size-6 shrink-0 text-brand-red' : 'size-6 shrink-0 text-link'} stroke={2} />
          <div className="flex flex-col gap-2">
            <DialogTitle>{shown.title}</DialogTitle>
            <DialogDescription>{shown.message}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={cancelDisabled}>
            {shown.cancelText}
          </Button>
          <Button type="button" variant={isDanger ? 'destructive' : 'default'} onClick={onConfirm} disabled={confirmDisabled}>
            {shown.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
