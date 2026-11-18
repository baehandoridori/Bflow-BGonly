// 압축하지 않는 zip (HTML v0.4.11 makeZip 과 같은 모양: 그림은 이미 압축돼 있어서 그대로 담는다). 피드백 내보내기가 쓴다.
// 메인은 파일에 한 조각씩 쓰고(createStoredZip), 테스트 모드는 한 덩어리로 만든다(storedZip). 이름은 UTF-8 (0x0800).
// DOM · Electron · import 없이 — node 시험 · 메인 묶음 · 화면이 그대로 읽는다.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(u8: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** zip 안의 시각 (이 PC 의 시각, 2초 단위). 1980년 전은 1980-01-01 로. */
export function zipDosStamp(d: Date): { time: number; date: number } {
  if (!Number.isFinite(d.getTime()) || d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** zip 32 의 한계 (4GB 바로 아래 · 파일 65535개). 끝의 목록 · 글 파일 자리로 16MB 를 남긴다. */
const ZIP_MAX = 0xffffffff;
const ZIP_ROOM = 16 * 1024 * 1024;
const ZIP_MAX_FILES = 65000;

/**
 * 한 파일씩 더하는 zip. entry() 가 돌려준 조각을 그 순서대로 쓰고, 마지막에 end() 의 조각을 쓴다.
 * end(first): first 에 든 이름을 목록 맨 앞에 (zip 을 열면 feedback.json · feedback.md 가 먼저 보이게).
 */
export function createStoredZip(at: Date = new Date()) {
  const enc = new TextEncoder();
  const dos = zipDosStamp(at);
  const entries: Array<{ name: string; nameBytes: Uint8Array; crc: number; size: number; offset: number }> = [];
  const names = new Set<string>();
  let offset = 0;
  const fits = (name: string, size: number) => entries.length < ZIP_MAX_FILES && offset + 30 + enc.encode(name).byteLength + size + ZIP_ROOM <= ZIP_MAX;
  return {
    /** 지금까지 쓴 바이트 */
    get offset() { return offset; },
    get count() { return entries.length; },
    fits,
    entry(name: string, data: Uint8Array): Uint8Array[] {
      if (!name || names.has(name)) throw new Error('zip 안에 같은 이름이 두 번 들어갈 수 없어요.');
      if (!fits(name, data.byteLength)) throw new Error('zip 파일이 너무 커졌어요.');
      const nameBytes = enc.encode(name); const crc = crc32(data);
      const head = new Uint8Array(30); const v = new DataView(head.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
      v.setUint16(10, dos.time, true); v.setUint16(12, dos.date, true);
      v.setUint32(14, crc, true); v.setUint32(18, data.byteLength, true); v.setUint32(22, data.byteLength, true);
      v.setUint16(26, nameBytes.byteLength, true); v.setUint16(28, 0, true);
      names.add(name);
      entries.push({ name, nameBytes, crc, size: data.byteLength, offset });
      offset += 30 + nameBytes.byteLength + data.byteLength;
      return [head, nameBytes, data];
    },
    end(first: readonly string[] = []): Uint8Array {
      const rank = (n: string) => { const i = first.indexOf(n); return i < 0 ? first.length : i; };
      const order = [...entries].sort((a, b) => rank(a.name) - rank(b.name));
      const parts: Uint8Array[] = [];
      for (const e of order) {
        const ch = new Uint8Array(46); const v = new DataView(ch.buffer);
        v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true);
        v.setUint16(12, dos.time, true); v.setUint16(14, dos.date, true);
        v.setUint32(16, e.crc, true); v.setUint32(20, e.size, true); v.setUint32(24, e.size, true);
        v.setUint16(28, e.nameBytes.byteLength, true); v.setUint16(30, 0, true); v.setUint16(32, 0, true);
        v.setUint16(34, 0, true); v.setUint16(36, 0, true); v.setUint32(38, 0, true); v.setUint32(42, e.offset, true);
        parts.push(ch, e.nameBytes);
      }
      const cdSize = parts.reduce((n, p) => n + p.byteLength, 0);
      const endRec = new Uint8Array(22); const v = new DataView(endRec.buffer);
      v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true);
      v.setUint32(12, cdSize, true); v.setUint32(16, offset, true);
      parts.push(endRec);
      return concatBytes(parts);
    },
  };
}
export type StoredZipWriter = ReturnType<typeof createStoredZip>;

/** 한 덩어리 zip (테스트 모드 · 시험). */
export function storedZip(files: ReadonlyArray<{ name: string; data: Uint8Array }>, at: Date = new Date(), first: readonly string[] = []): Uint8Array<ArrayBuffer> {
  const z = createStoredZip(at);
  const parts: Uint8Array[] = [];
  for (const f of files) parts.push(...z.entry(f.name, f.data));
  parts.push(z.end(first));
  return concatBytes(parts);
}
