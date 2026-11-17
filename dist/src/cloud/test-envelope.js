/**
 * Self-contained encrypted connectivity probe (NOT a Finance vault backup).
 * The random KDF salt is carried with the ciphertext, so another device can
 * decrypt it with the same passphrase without needing local IndexedDB data.
 * No statement data or password is transmitted or stored in this probe.
 */
const ITERATIONS = 310_000;
const DOMAIN = 'finance:v0.9:onedrive-connection-test';
const MARKER = 'finance-onedrive-probe-v1';
const MAX_ENVELOPE_LENGTH = 24000;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
function toBase64(data) {
    let text = '';
    for (const byte of data)
        text += String.fromCharCode(byte);
    return btoa(text);
}
function fromBase64(base64, expectedLength) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
        throw new Error('暗号化形式が不正です。');
    const value = atob(base64);
    if (expectedLength !== undefined && value.length !== expectedLength)
        throw new Error('暗号化パラメータが不正です。');
    return Uint8Array.from(value, ch => ch.charCodeAt(0));
}
async function keyFrom(passphrase, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function createEncryptedProbe(passphrase) {
    if (passphrase.length < 12)
        throw new Error('パスフレーズは12文字以上にしてください。');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const probe = {
        marker: MARKER,
        createdAt: new Date().toISOString(),
        nonce: Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join(''),
    };
    const key = await keyFrom(passphrase, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(DOMAIN) }, key, enc.encode(JSON.stringify(probe)));
    const envelope = {
        version: 1, type: 'finance-test-only', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
        cipher: 'AES-256-GCM', salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
    return { encrypted: JSON.stringify(envelope), probe };
}
export async function decryptEncryptedProbe(encrypted, passphrase) {
    if (encrypted.length > MAX_ENVELOPE_LENGTH)
        throw new Error('テストファイルが大きすぎます。');
    let envelope;
    try {
        envelope = JSON.parse(encrypted);
    }
    catch {
        throw new Error('テストファイルの形式を読み取れません。');
    }
    if (envelope?.version !== 1 || envelope.type !== 'finance-test-only' ||
        envelope.kdf !== 'PBKDF2-SHA256' || envelope.cipher !== 'AES-256-GCM' || envelope.iterations !== ITERATIONS) {
        throw new Error('このFinance接続テストには対応していないファイルです。');
    }
    const salt = fromBase64(envelope.salt, 16);
    // Web Crypto requires an ArrayBuffer-backed view (not ArrayBufferLike).
    // Copy decoded bytes into fresh Uint8Arrays; ciphertext and file format are unchanged.
    const iv = new Uint8Array(fromBase64(envelope.iv, 12));
    const ciphertext = new Uint8Array(fromBase64(envelope.ciphertext));
    if (ciphertext.length < 16 || ciphertext.length > 10000)
        throw new Error('暗号化データの長さが不正です。');
    try {
        const key = await keyFrom(passphrase, salt);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(DOMAIN) }, key, ciphertext);
        const probe = JSON.parse(dec.decode(plaintext));
        if (probe.marker !== MARKER || !/^\d{4}-\d\d-\d\dT/.test(probe.createdAt) || !/^[0-9a-f]{16}$/.test(probe.nonce))
            throw new Error('invalid');
        return probe;
    }
    catch {
        throw new Error('復号できませんでした。パスフレーズまたはクラウド上のファイルを確認してください。');
    }
}
export const PROBE_FILE_NAME = 'finance-v09-connectivity.enc.json';
