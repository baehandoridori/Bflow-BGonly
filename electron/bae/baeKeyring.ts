/**
 * OpenAI 키를 메인의 메모리에만 두는 곳 (계획 14의 4-2). 디스크 · 기록 · 화면으로 내보내지 않는다.
 * 로그인한 사람(세션 epoch)이 바뀌거나 키가 바뀌었다는 신호가 오면 버리고, 다음 호출 때 서버에서 다시 받는다.
 */
export interface BaeKeyOrigin { userId: string; epoch: number }

export function createBaeKeyring(fetchKey: (actorId: string) => Promise<{ key: string; label: string }>) {
  let held: { userId: string; epoch: number; key: string; label: string } | null = null;
  let inflight: Promise<{ key: string; label: string }> | null = null;
  let generation = 0;
  return {
    /** 이 세션의 키. 처음 한 번 서버에서 받고, 그 뒤로는 메모리의 것. */
    async keyFor(origin: BaeKeyOrigin): Promise<{ key: string; label: string }> {
      if (held && held.userId === origin.userId && held.epoch === origin.epoch) return { key: held.key, label: held.label };
      if (!inflight) {
        const gen = generation;
        inflight = fetchKey(origin.userId).then((k) => {
          if (gen === generation) held = { userId: origin.userId, epoch: origin.epoch, key: k.key, label: k.label };
          return k;
        }).finally(() => { inflight = null; });
      }
      return inflight;
    },
    /** 키가 바뀌었거나 로그인한 사람이 바뀜: 버린다. */
    forget(): void { held = null; generation++; },
    /** 시험용: 지금 들고 있는지 (키 글자는 돌려주지 않는다). */
    holds(): boolean { return held !== null; },
  };
}
export type BaeKeyring = ReturnType<typeof createBaeKeyring>;
