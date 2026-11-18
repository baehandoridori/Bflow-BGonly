// 작은 글자 도우미 (HTML 그대로).

/** HTML hashStr: 러프 그림이 같은지 보는 열쇠 (rough.key). */
export function hashStr(s: unknown): string {
  let h = 5381; const t = String(s || '');
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + t.length;
}

/** HTML won(): 달러 → '약 N원'. rate 는 설정 책장 prices.krwPerUsd. */
export function won(usd: number | null | undefined, rate: number): string {
  return usd == null ? '' : '약 ' + Math.round(usd * (Number(rate) || 1400)).toLocaleString('ko-KR') + '원';
}

/** HTML manualVersion(): 주문서를 쓴 매뉴얼 판. custom = 관리자가 고친 글을 쓰는 중. */
export function manualVersion(manualText: string, custom: boolean): string {
  const m = /v\d+(?:\.\d+)*/.exec(String(manualText || '').split('\n')[0]);
  return custom ? '직접 고친 매뉴얼' + (m ? ' (' + m[0] + ' 바탕)' : '') : (m ? m[0] : '알 수 없음');
}

/** HTML blocksVersion(): 고정 문장 판. 고치지 않은 글이면 그 첫 줄의 판. */
export function blocksVersion(fixedText: string, custom: boolean): string {
  return custom ? '직접 고친 고정 문장' : ((/v\d+(?:\.\d+)*/.exec(String(fixedText || '').split('\n')[0]) || ['v1'])[0]);
}

/** HTML promptCount() 의 글: 영어 주문서 단어 수와 너무 길 때 경고. */
export function promptCountText(prompt: string): { text: string; warn: boolean } {
  const n = (String(prompt || '').match(/\S+/g) || []).length;
  return { text: n ? '영어 주문서 ' + n + '단어' + (n > 850 ? ' · 길어요. 그림 모델이 일부를 놓칠 수 있어요.' : '') : '', warn: n > 850 };
}
