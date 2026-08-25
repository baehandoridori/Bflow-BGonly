import type { CalendarCommittedReplacementDeleteMarker } from '../src/shared/calendarApiContract';

type GoogleCommittedDeleteMarker = Extract<
  CalendarCommittedReplacementDeleteMarker,
  { committedGoogleDelete: true }
>;

type GoogleCalendarDeleteBoundaryDeps = {
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>;
  getEvent: (calendarId: string, eventId: string) => Promise<{ id: string } | null>;
  emitLocal: (marker: GoogleCommittedDeleteMarker) => void;
  emitCrossClient: (marker: GoogleCommittedDeleteMarker) => void;
  onFanoutError?: (error: unknown) => void;
};

function reportFanoutError(
  error: unknown,
  onFanoutError: ((error: unknown) => void) | undefined,
): void {
  try {
    if (onFanoutError) onFanoutError(error);
    else console.warn('[Calendar] Google committed-delete fanout failed:', error);
  } catch {
    // persistence 성공 뒤 진단 callback 실패도 invoke 결과를 뒤집지 않는다.
  }
}

/** ordinary Google delete의 persistence 경계.
 * DELETE 응답 유실 뒤 authoritative 부재가 확인되면 commit으로 복구하고, 행이 남아
 * 있거나 readback 자체가 실패하면 marker 없이 오류를 유지한다. */
export async function deleteGoogleEventWithCommittedMarker(
  calendarId: string,
  eventId: string,
  deps: GoogleCalendarDeleteBoundaryDeps,
): Promise<void> {
  try {
    await deps.deleteEvent(calendarId, eventId);
  } catch (deleteError) {
    let latest: { id: string } | null;
    try {
      latest = await deps.getEvent(calendarId, eventId);
    } catch (readbackError) {
      const combinedError = new Error('Google ordinary delete readback unavailable') as Error & {
        errors: unknown[];
      };
      combinedError.errors = [deleteError, readbackError];
      throw combinedError;
    }
    if (latest) throw deleteError;
  }

  const marker: GoogleCommittedDeleteMarker = {
    eventId,
    action: 'delete',
    calendarId,
    committedGoogleDelete: true,
  };
  try {
    deps.emitLocal(marker);
  } catch (error) {
    reportFanoutError(error, deps.onFanoutError);
  }
  try {
    deps.emitCrossClient(marker);
  } catch (error) {
    reportFanoutError(error, deps.onFanoutError);
  }
}
