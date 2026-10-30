// Uint8Array ↔ base64. 큰 배열도 스택이 넘치지 않게 조각 내서 바꾼다
// (String.fromCharCode(...bytes) 는 수십만 개 인자에서 «Maximum call stack size exceeded»).
// 겹침 확인: 기존 코드에 base64 변환 도구는 없음.

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const part = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode.apply(null, part as unknown as number[]);
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
