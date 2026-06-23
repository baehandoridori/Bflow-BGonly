interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
}

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

function createFallbackBytes(source?: RandomSource): Uint8Array {
  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

export function createUuid(source: RandomSource | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') {
    return source.randomUUID();
  }

  const bytes = createFallbackBytes(source);
  const hex = Array.from(bytes, byteToHex);
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
