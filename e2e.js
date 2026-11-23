// ============================================================================
// Mã hóa đầu cuối giữa máy tính và điện thoại (dùng chung: Electron main + app điện thoại).
// Chỉ dùng WebCrypto có sẵn (Node 20+ / trình duyệt), không thêm thư viện.
//
// Cách hoạt động:
//  1. Mỗi thiết bị có 1 cặp khóa ECDH P-256 (khóa riêng không bao giờ rời máy).
//  2. Máy tính giữ 1 "khóa chung của quán" (AES-256 ngẫu nhiên). Khi ghép điện thoại, máy tính
//     dùng ECDH(khóa riêng máy tính, khóa công khai điện thoại) → khóa bọc, rồi bọc khóa chung gửi cho điện thoại.
//  3. Mọi lệnh / kết quả / tiến độ / file mã hóa bằng khóa chung (AES-GCM), kèm "nhãn" (AAD) gắn với
//     quán + loại + mã dòng → máy trung gian không đọc được, cũng không tráo dòng này sang dòng khác được.
//  4. Mã QR chứa dấu vân tay khóa công khai máy tính → điện thoại kiểm tra, chặn máy trung gian tráo khóa.
// ============================================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DBE2E = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const subtle = globalThis.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const VERSION = 'v1';

  // ---------- base64 (chạy được cả Node lẫn trình duyệt) ----------
  const toB64 = u8 => {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = s => {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u;
  };
  const bytes = x => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : te.encode(typeof x === 'string' ? x : JSON.stringify(x)));

  // ---------- Khóa thiết bị (ECDH P-256) ----------
  async function generateDeviceKeys() {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    return { publicJwk: await subtle.exportKey('jwk', kp.publicKey), privateJwk: await subtle.exportKey('jwk', kp.privateKey) };
  }
  const pubOnly = jwk => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });

  // Dấu vân tay ngắn của khóa công khai (in vào mã QR để điện thoại so khớp).
  async function fingerprint(pubJwk) {
    const d = new Uint8Array(await subtle.digest('SHA-256', te.encode(`${pubJwk.crv}|${pubJwk.x}|${pubJwk.y}`)));
    return [...d.subarray(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Khóa bọc giữa 2 thiết bị: ECDH → HKDF-SHA256 → AES-GCM 256.
  async function deriveWrapKey(myPrivateJwk, theirPublicJwk, context = 'dangbai-wrap-v1') {
    const priv = await subtle.importKey('jwk', myPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const pub = await subtle.importKey('jwk', pubOnly(theirPublicJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
    const hk = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(context) }, hk,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // ---------- Khóa chung của quán (AES-256) ----------
  function newOwnerKeyRaw() { return toB64(globalThis.crypto.getRandomValues(new Uint8Array(32))); }
  function importOwnerKey(rawB64) {
    return subtle.importKey('raw', fromB64(rawB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  // ---------- Mã hóa / giải mã ----------
  // Kết quả: "v1.<iv>.<bản mã>" (base64). aad = nhãn gắn với ngữ cảnh, phải giống hệt lúc giải mã.
  async function encrypt(key, data, aad = '') {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, bytes(data)));
    return `${VERSION}.${toB64(iv)}.${toB64(ct)}`;
  }
  async function decryptBytes(key, box, aad = '') {
    const [v, ivB64, ctB64] = String(box || '').split('.');
    if (v !== VERSION || !ivB64 || !ctB64) throw new Error('Dữ liệu mã hóa không đúng định dạng.');
    try {
      return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64), additionalData: te.encode(aad) }, key, fromB64(ctB64)));
    } catch { throw new Error('Không giải mã được (sai khóa hoặc dữ liệu bị sửa).'); }
  }
  async function decryptText(key, box, aad = '') { return td.decode(await decryptBytes(key, box, aad)); }
  async function decryptJSON(key, box, aad = '') { return JSON.parse(await decryptText(key, box, aad)); }

  // Bọc / mở khóa chung cho từng điện thoại.
  async function wrapOwnerKey(ownerRawB64, wrapKey, aad) { return encrypt(wrapKey, fromB64(ownerRawB64), aad); }
  async function unwrapOwnerKey(box, wrapKey, aad) { return toB64(await decryptBytes(wrapKey, box, aad)); }

  // Nhãn (AAD) chuẩn cho từng loại dữ liệu.
  const aad = {
    command: (owner, id, type) => `cmd|${owner}|${id}|${type}`,
    result: (owner, id) => `res|${owner}|${id}`,
    event: (owner, kind, ref) => `evt|${owner}|${kind}|${ref || ''}`,
    file: (owner, path) => `file|${owner}|${path}`,
    wrap: (owner, deviceId, version) => `wrap|${owner}|${deviceId}|${version}`
  };

  return {
    VERSION, toB64, fromB64, generateDeviceKeys, pubOnly, fingerprint, deriveWrapKey,
    newOwnerKeyRaw, importOwnerKey, encrypt, decryptBytes, decryptText, decryptJSON, wrapOwnerKey, unwrapOwnerKey, aad
  };
});
