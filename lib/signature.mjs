// Official web client's public request-signing constants; these are not account credentials.
export const APP_ID = '1497016617475903488';
const KEY = '57325972627c40bd8c77296d39293705';
const CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz0123456789';
const SHIFTS = [7,12,17,22, 5,9,14,20, 4,11,16,23, 6,10,15,21];
const K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
// RFC 1321 MD5, used only for the official API protocol (not password storage).
export function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new ArrayBuffer(size), data = new Uint8Array(buffer), view = new DataView(buffer);
  data.set(bytes); data[bytes.length] = 0x80;
  view.setUint32(size - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(size - 4, Math.floor(bytes.length / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let offset = 0; offset < size; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const x = (a + f + K[i] + view.getUint32(offset + g * 4, true)) >>> 0;
      const shift = SHIFTS[Math.floor(i / 16) * 4 + i % 4];
      const next = (b + ((x << shift) | (x >>> (32 - shift)))) >>> 0;
      a = d; d = c; c = b; b = next;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0,b0,c0,d0].map(x => [0,8,16,24].map(n => ((x >>> n) & 255).toString(16).padStart(2,'0')).join('')).join('');
}
export function signedParams(timestamp = Date.now(), nonce) {
  nonce ||= Array.from(crypto.getRandomValues(new Uint8Array(32)), n => CHARS[n % CHARS.length]).join('');
  return {appId: APP_ID, timeStamp: String(timestamp), nonce, sign: md5(`appId=${APP_ID}&nonce=${nonce}&timeStamp=${timestamp}&key=${KEY}`)};
}
