import type { MouseEvent } from 'react';
import { Armchair, ArrowLeft, Coins } from 'lucide-react';

import { originFromActivation, type Point } from '@/features/playground/transition/dotWipeMath';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';

interface JbbjHouseProps {
  onBack(origin: Point): void;
}

function getOrigin(event: MouseEvent<HTMLButtonElement>): Point {
  return originFromActivation(
    event.clientX,
    event.clientY,
    event.detail,
    event.currentTarget.getBoundingClientRect(),
  );
}

export function JbbjHouse({ onBack }: JbbjHouseProps) {
  const walletPoints = useMarketPreviewStore((state) => state.visible?.account.walletPoints ?? null);

  return (
    <div className="flex h-full overflow-y-auto px-5 py-8 sm:px-8">
      <div className="m-auto w-full max-w-2xl rounded-3xl border border-bg-border bg-bg-card p-6 shadow-xl sm:p-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent-sub">
          <Armchair aria-hidden="true" size={28} />
        </div>
        <p className="mt-7 text-sm font-semibold tracking-[0.14em] text-text-secondary">CALM LOUNGE</p>
        <h2 id="playground-house-title" tabIndex={-1} className="mt-2 text-3xl font-bold text-text-primary outline-none">
          JBBJ 하우스
        </h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-text-secondary">
          잠깐 속도를 늦추고 쉬어 가는 조용한 라운지예요. 모은 포인트를 확인하고 다음 놀이를 천천히 골라보세요.
        </p>

        <section className="mt-8 rounded-2xl border border-bg-border bg-bg-primary/45 p-5" aria-labelledby="house-point-heading">
          <div className="flex items-center gap-3 text-text-secondary">
            <Coins aria-hidden="true" size={20} />
            <h3 id="house-point-heading" className="text-sm font-medium">현재 포인트 잔액</h3>
          </div>
          <p className="mt-3 text-3xl font-bold tabular-nums text-text-primary">
            {walletPoints === null ? '확인 중' : `${walletPoints.toLocaleString('ko-KR')}P`}
          </p>
          <p className="mt-2 text-sm text-text-secondary">여기서는 잔액만 편안하게 확인할 수 있어요.</p>
        </section>

        <button
          type="button"
          onClick={(event) => onBack(getOrigin(event))}
          className="mt-8 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          놀이터로 돌아가기
        </button>
      </div>
    </div>
  );
}
