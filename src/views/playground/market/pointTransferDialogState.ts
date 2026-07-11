const BLOCKED_CLOSE_MESSAGE = '포인트 이동이 끝날 때까지 잠시 기다려 주세요.';

interface PointTransferDialogCloseRequest {
  blocked: boolean;
  setLocalError(message: string | null): void;
  clearError(): void;
  onClose(): void;
}

export function requestPointTransferDialogClose({
  blocked,
  setLocalError,
  clearError,
  onClose,
}: PointTransferDialogCloseRequest): boolean {
  if (blocked) {
    setLocalError(BLOCKED_CLOSE_MESSAGE);
    return false;
  }

  setLocalError(null);
  clearError();
  onClose();
  return true;
}
