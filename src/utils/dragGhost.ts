// 커스텀 드래그 고스트(setDragImage 칩).
//   native HTML5 드래그의 기본 고스트는 "카드 전체를 흐릿하게 스냅샷"이라 크고 밋밋해 들어올린 느낌이 약하다.
//   대신 작은 썸네일 + 이름 칩을 만들어 커서에 붙여, 무엇을 옮기는지 또렷이 보이게 한다.
//   테마(라이트/다크)는 실시간 CSS 변수(--color-*)를 읽어 맞춘다.

/** 루트에서 디자인 토큰(RGB 삼원색 "108 92 231")을 읽어 옴. 없으면 폴백. */
function tokenRgb(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

/**
 * 드래그 고스트 칩을 화면 밖에 만들어 dataTransfer.setDragImage 로 지정한다.
 * 브라우저가 dragstart 시점에 스냅샷을 뜨므로, 다음 태스크(setTimeout 0)에서 안전하게 제거한다.
 *
 * 실패(구형 엔진·보안 예외 등)해도 native 기본 고스트로 드래그는 그대로 동작하도록 try/catch 로 감싼다.
 */
export function applyDragGhost(
  dataTransfer: DataTransfer,
  opts: { label: string; imageUrl?: string | null },
  offsetX = 16,
  offsetY = 18,
): void {
  if (typeof document === 'undefined') return;
  try {
    const accent = tokenRgb('--color-accent', '108 92 231');
    const card = tokenRgb('--color-bg-card', '26 29 39');
    const border = tokenRgb('--color-bg-border', '45 48 65');
    const text = tokenRgb('--color-text-primary', '232 232 238');

    const chip = document.createElement('div');
    chip.style.cssText = [
      'position:fixed',
      'top:-1000px',
      'left:-1000px',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'max-width:220px',
      'padding:6px 12px 6px 6px',
      'border-radius:10px',
      `background:rgb(${card})`,
      `border:1px solid rgb(${accent} / 0.6)`,
      'box-shadow:0 10px 24px rgba(0,0,0,0.4), 0 0 0 3px rgb(' + accent + ' / 0.14)',
      `color:rgb(${text})`,
      'font-size:12px',
      'font-weight:600',
      'line-height:1',
      'pointer-events:none',
      '-webkit-font-smoothing:antialiased',
    ].join(';');

    if (opts.imageUrl) {
      const thumb = document.createElement('div');
      thumb.style.cssText = [
        'width:34px',
        'height:44px',
        'flex:0 0 auto',
        'border-radius:6px',
        'overflow:hidden',
        `border:1px solid rgb(${border})`,
        `background:rgb(${border} / 0.4) center/cover no-repeat`,
        // 이미 화면에 그려진 이미지라 브라우저 캐시에서 즉시 그려진다(URL 동일). 못 그려도 배경색으로 폴백.
        `background-image:url("${opts.imageUrl.replace(/"/g, '%22')}")`,
      ].join(';');
      chip.appendChild(thumb);
    } else {
      const dot = document.createElement('span');
      dot.style.cssText = [
        'width:8px',
        'height:8px',
        'flex:0 0 auto',
        'margin-left:6px',
        'border-radius:9999px',
        `background:rgb(${accent})`,
        `box-shadow:0 0 8px 1px rgb(${accent} / 0.7)`,
      ].join(';');
      chip.appendChild(dot);
    }

    const label = document.createElement('span');
    label.textContent = opts.label;
    // min-width:0 — flex 항목 기본 min-width:auto 면 긴 이름이 ellipsis 대신 칩을 넘쳐 늘린다.
    label.style.cssText = 'min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    chip.appendChild(label);

    document.body.appendChild(chip);
    // 제거는 setDragImage 성공/실패와 무관하게 먼저 예약 — 예외가 나도 칩이 body 에 남지 않게.
    // setTimeout(0) 은 현재 태스크(=스냅샷 캡처) 이후에 실행되므로 고스트 표시에는 영향 없다.
    setTimeout(() => chip.remove(), 0);
    dataTransfer.setDragImage(chip, offsetX, offsetY);
  } catch {
    // native 기본 고스트로 폴백 — 드래그 동작 자체는 유지.
  }
}
