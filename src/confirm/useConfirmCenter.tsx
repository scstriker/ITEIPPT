import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { resolveConfirmCopy, type ConfirmActionId, type ConfirmCopyEntry, type ConfirmExecutor, type ConfirmPayloadMap, type ConfirmRequest } from './confirmActions';

interface PendingConfirm {
  actionId: ConfirmActionId;
  copy: ConfirmCopyEntry;
  executor: ConfirmExecutor;
}

export function useConfirmCenter(): {
  requestConfirm: ConfirmRequest;
  confirmModal: ReactNode;
  confirmBusy: boolean;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [executing, setExecuting] = useState(false);

  const requestConfirm = useCallback(
    <K extends ConfirmActionId>(actionId: K, payload: ConfirmPayloadMap[K], executor: ConfirmExecutor) => {
      if (executing || pending) {
        return;
      }
      setPending({
        actionId,
        copy: resolveConfirmCopy(actionId, payload),
        executor,
      });
    },
    [executing, pending],
  );

  const closeIfIdle = useCallback(() => {
    if (executing) {
      return;
    }
    setPending(null);
  }, [executing]);

  const handleConfirm = useCallback(async () => {
    if (!pending || executing) {
      return;
    }
    setExecuting(true);
    try {
      await Promise.resolve(pending.executor());
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[confirm] action ${pending.actionId} failed`, error);
    } finally {
      setPending(null);
      setExecuting(false);
    }
  }, [executing, pending]);

  const confirmModal = useMemo(
    () => (
      <ConfirmModal
        open={Boolean(pending)}
        title={pending?.copy.title ?? ''}
        message={pending?.copy.message ?? ''}
        confirmText={pending?.copy.confirmText ?? '确认'}
        cancelText={pending?.copy.cancelText ?? '取消'}
        variant={pending?.copy.variant ?? 'warning'}
        confirmDisabled={executing}
        cancelDisabled={executing}
        onConfirm={() => {
          void handleConfirm();
        }}
        onCancel={closeIfIdle}
      />
    ),
    [closeIfIdle, executing, handleConfirm, pending],
  );

  return {
    requestConfirm,
    confirmModal,
    confirmBusy: executing || Boolean(pending),
  };
}
