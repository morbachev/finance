/**
 * Local-only encrypted statement vault.
 * The IndexedDB stores ciphertext, IVs, random IDs, and password verifier only.
 * The passphrase and derived CryptoKey stay in tab memory, never in persistent storage.
 * Cloud sync and an off-device backup are intentionally not implemented in v0.7.
 */
import type { ParsedStatement } from '../models/types.js';

const DB_NAME = 'finance-local-vault-v1';
const META_STORE = 'meta';
const STATEMENTS_STORE = 'statements';
const VERIFIER = 'finance-vault-v1-check';
const KDF_ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

interface Ciphertext { iv: number[]; data: ArrayBuffer }
interface VaultMeta { id: 'vault'; version: 1; iterations: number; salt: number[]; verifier: Ciphertext }
interface VaultRecord { id: string; statement: Ciphertext; source?: Ciphertext }
export interface LocalSource { bytes: Uint8Array; mime: string }
export interface VaultDocument { statement: ParsedStatement; sourceMime?: string }

let key: CryptoKey | null = null;
let cachedDb: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!cachedDb) cachedDb = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STATEMENTS_STORE)) db.createObjectStore(STATEMENTS_STORE, { keyPath: 'id' });
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDBを開けません。'));
    req.onsuccess = () => resolve(req.result);
  }).catch(error => { cachedDb = null; throw error; });
  return cachedDb;
}

async function read<T>(storeName: string, recordKey: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(recordKey);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function listRecords(): Promise<VaultRecord[]> {
  const db = await openDatabase();
  return new Promise<VaultRecord[]>((resolve, reject) => {
    const request = db.transaction(STATEMENTS_STORE, 'readonly').objectStore(STATEMENTS_STORE).getAll();
    request.onsuccess = () => resolve(request.result as VaultRecord[]);
    request.onerror = () => reject(request.error);
  });
}

async function write(storeName: string, value: VaultMeta | VaultRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const txn = db.transaction(storeName, 'readwrite');
    txn.objectStore(storeName).put(value);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error ?? new Error('保存に失敗しました。'));
    txn.onabort = () => reject(txn.error ?? new Error('保存を中断しました。'));
  });
}

async function erase(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const txn = db.transaction(STATEMENTS_STORE, 'readwrite');
    txn.objectStore(STATEMENTS_STORE).delete(id);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error ?? new Error('削除に失敗しました。'));
    txn.onabort = () => reject(txn.error ?? new Error('削除を中断しました。'));
  });
}

async function derive(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encrypt(data: Uint8Array, cryptKey: CryptoKey): Promise<Ciphertext> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptKey, new Uint8Array(data));
  return { iv: Array.from(iv), data: encrypted };
}

async function decrypt(encrypted: Ciphertext, cryptKey: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) }, cryptKey, encrypted.data);
  return new Uint8Array(raw);
}

async function unlockedKey(): Promise<CryptoKey> {
  if (!key) throw new Error('暗号化ストレージがロックされています。');
  return key;
}

export async function hasVault(): Promise<boolean> {
  return !!await read<VaultMeta>(META_STORE, 'vault');
}
export function isUnlocked(): boolean { return key !== null; }
export function lockVault(): void { key = null; }

export async function createVault(passphrase: string): Promise<void> {
  if (await hasVault()) throw new Error('暗号化ストレージは既に存在します。');
  if (passphrase.length < 12) throw new Error('パスフレーズは12文字以上にしてください。');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const freshKey = await derive(passphrase, salt, KDF_ITERATIONS);
  const verifier = await encrypt(encoder.encode(VERIFIER), freshKey);
  await write(META_STORE, { id: 'vault', version: 1, iterations: KDF_ITERATIONS, salt: Array.from(salt), verifier });
  key = freshKey;
}

export async function unlockVault(passphrase: string): Promise<void> {
  const meta = await read<VaultMeta>(META_STORE, 'vault');
  if (!meta || meta.version !== 1) throw new Error('対応していない保存形式です。');
  const derived = await derive(passphrase, new Uint8Array(meta.salt), meta.iterations);
  try {
    if (decoder.decode(await decrypt(meta.verifier, derived)) !== VERIFIER) throw new Error('invalid');
  } catch {
    throw new Error('パスフレーズが違うか、保存データが破損しています。');
  }
  key = derived;
}

export async function saveStatement(statement: ParsedStatement, source?: LocalSource, id?: string): Promise<string> {
  const cryptKey = await unlockedKey();
  const recordId = id ?? crypto.randomUUID();
  const existing = id ? await read<VaultRecord>(STATEMENTS_STORE, id) : undefined;
  const sourceMime = source?.mime ?? (existing ? (statement.sourceKind === 'pdf' ? 'application/pdf' : 'text/plain') : undefined);
  const document: VaultDocument = { statement: structuredClone(statement), sourceMime };
  const encryptedStatement = await encrypt(encoder.encode(JSON.stringify(document)), cryptKey);
  const encryptedSource = source ? await encrypt(source.bytes, cryptKey) : existing?.source;
  await write(STATEMENTS_STORE, { id: recordId, statement: encryptedStatement, source: encryptedSource });
  return recordId;
}

/** Encrypt all records before opening the write transaction, then commit in one IDB transaction. */
export async function saveStatementsBatch(
  items: Array<{ statement: ParsedStatement; source?: LocalSource; id?: string }>,
): Promise<string[]> {
  const cryptKey = await unlockedKey();
  if (!items.length) return [];
  const records: VaultRecord[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    const id = item.id ?? crypto.randomUUID();
    if (ids.has(id)) throw new Error('一括取込対象に同じ保存IDが重複しています。');
    ids.add(id);
    const old = item.id ? await read<VaultRecord>(STATEMENTS_STORE, item.id) : undefined;
    if (item.id && !old) throw new Error('更新対象の保存済み明細が見つかりません。');
    // Pasted text is represented by its normalized parsed rows, not a second raw source copy.
    const pdf = item.statement.sourceKind === 'pdf';
    const original = pdf ? (item.source ? await encrypt(item.source.bytes, cryptKey) : old?.source) : undefined;
    if (pdf && (!original || (item.source && item.source.mime !== 'application/pdf'))) {
      throw new Error('PDF原本がないため保存できません。');
    }
    const document: VaultDocument = {
      statement: structuredClone(item.statement),
      sourceMime: pdf ? 'application/pdf' : undefined,
    };
    records.push({ id, statement: await encrypt(encoder.encode(JSON.stringify(document)), cryptKey), source: original });
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const txn = db.transaction(STATEMENTS_STORE, 'readwrite');
    const store = txn.objectStore(STATEMENTS_STORE);
    for (const record of records) store.put(record);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error ?? new Error('一括保存に失敗しました。'));
    txn.onabort = () => reject(txn.error ?? new Error('一括保存を中断しました。'));
  });
  return records.map(record => record.id);
}

export async function readStatements(): Promise<Array<{ id: string; statement: ParsedStatement; hasSource: boolean }>> {
  const cryptKey = await unlockedKey();
  const records = await listRecords();
  const result: Array<{ id: string; statement: ParsedStatement; hasSource: boolean }> = [];
  for (const record of records) {
    const text = decoder.decode(await decrypt(record.statement, cryptKey));
    const payload = JSON.parse(text) as VaultDocument;
    result.push({ id: record.id, statement: payload.statement, hasSource: !!record.source });
  }
  return result;
}

export async function readOriginal(id: string): Promise<{ bytes: Uint8Array; mime: string; name: string } | null> {
  const cryptKey = await unlockedKey();
  const record = await read<VaultRecord>(STATEMENTS_STORE, id);
  if (!record?.source) return null;
  const data = JSON.parse(decoder.decode(await decrypt(record.statement, cryptKey))) as VaultDocument;
  return { bytes: await decrypt(record.source, cryptKey), mime: data.sourceMime ?? 'application/octet-stream', name: data.statement.sourceName };
}

export async function deleteSaved(id: string): Promise<void> {
  await unlockedKey();
  await erase(id);
}

/** Encrypted backup: the passphrase is never included. Metadata is only KDF parameters and ciphertext. */
export async function exportEncryptedBackup(): Promise<Blob> {
  await unlockedKey();
  const meta = await read<VaultMeta>(META_STORE, 'vault');
  if (!meta) throw new Error('保存済みデータがありません。');
  const records = await listRecords();
  const to64 = (bytes: ArrayBuffer): string => {
    const a = new Uint8Array(bytes);
    // Process in chunks to avoid argument limits for PDFs.
    let s = '';
    for (let start = 0; start < a.length; start += 0x4000) s += String.fromCharCode(...a.subarray(start, start + 0x4000));
    return btoa(s);
  };
  const cipherJson = (cipher: Ciphertext) => ({ iv: cipher.iv, data: to64(cipher.data) });
  const backup = {
    format: 'finance-encrypted-backup-v1',
    createdAt: new Date().toISOString(),
    meta: { ...meta, verifier: cipherJson(meta.verifier) },
    records: records.map(rec => ({ id: rec.id, statement: cipherJson(rec.statement), source: rec.source ? cipherJson(rec.source) : undefined })),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Restores an exported ciphertext-only backup into a fresh vault. Never merges or overwrites. */
export async function restoreEncryptedBackup(file: File, passphrase: string): Promise<void> {
  if (await hasVault()) throw new Error('既存の保存領域があるため復元できません。誤った上書きを防ぐ仕様です。');
  if (file.size > 150 * 1024 * 1024) throw new Error('バックアップが大きすぎます（150MB上限）。');
  const backup = JSON.parse(await file.text()) as {
    format?: string;
    meta?: VaultMeta & { verifier: { iv: number[]; data: string } };
    records?: Array<{ id: string; statement: { iv: number[]; data: string }; source?: { iv: number[]; data: string } }>;
  };
  if (backup.format !== 'finance-encrypted-backup-v1' || !backup.meta || !Array.isArray(backup.records) || backup.records.length > 5000) {
    throw new Error('Financeの暗号化バックアップ形式ではありません。');
  }
  const meta = backup.meta;
  if (meta.version !== 1 || !Array.isArray(meta.salt) || meta.salt.length !== 16 || meta.iterations !== KDF_ITERATIONS) {
    throw new Error('対応していない暗号化形式です。');
  }
  const from64 = (s: string): ArrayBuffer => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
  const dec = (v: { iv: number[]; data: string }): Ciphertext => {
    if (!Array.isArray(v?.iv) || v.iv.length !== 12 || typeof v.data !== 'string') throw new Error('バックアップの暗号データが不正です。');
    return { iv: v.iv, data: from64(v.data) };
  };
  const verifier = dec(meta.verifier);
  const testKey = await derive(passphrase, new Uint8Array(meta.salt), meta.iterations);
  try { if (decoder.decode(await decrypt(verifier, testKey)) !== VERIFIER) throw new Error('bad'); }
  catch { throw new Error('バックアップの復号パスフレーズが違います。'); }
  const seen = new Set<string>();
  const records: VaultRecord[] = [];
  for (const entry of backup.records) {
    if (typeof entry?.id !== 'string' || !entry.id || seen.has(entry.id)) throw new Error('バックアップの明細IDが不正です。');
    seen.add(entry.id);
    const ciphertext = dec(entry.statement);
    // Verify every statement before writing anything to IndexedDB.
    const payload = JSON.parse(decoder.decode(await decrypt(ciphertext, testKey))) as VaultDocument;
    if (!payload.statement || !Array.isArray(payload.statement.rows)) throw new Error('バックアップの明細が不正です。');
    const sourceCipher = entry.source ? dec(entry.source) : undefined;
    if (sourceCipher) await decrypt(sourceCipher, testKey);
    records.push({ id: entry.id, statement: ciphertext, source: sourceCipher });
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const txn = db.transaction([META_STORE, STATEMENTS_STORE], 'readwrite');
    txn.objectStore(META_STORE).put({ id: 'vault', version: 1, salt: meta.salt, iterations: meta.iterations, verifier } satisfies VaultMeta);
    for (const entry of records) txn.objectStore(STATEMENTS_STORE).put(entry);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error ?? new Error('復元に失敗しました。'));
    txn.onabort = () => reject(txn.error ?? new Error('復元に失敗しました。'));
  });
  key = testKey;
}

/** Explicitly remove only the historical Finance IndexedDB after external verification. */
export async function deleteLegacyVault():Promise<void> {
  lockVault();
  const previous=cachedDb;
  cachedDb=null;
  if(previous){
    // No other transaction should be running when the caller reaches here.
    try{(await previous).close();}catch{/* Opening failed; deletion can still proceed. */}
  }
  await new Promise<void>((resolve,reject)=>{
    const request=indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess=()=>resolve();
    request.onerror=()=>reject(request.error??new Error('旧保管庫を削除できませんでした。'));
    request.onblocked=()=>reject(new Error('別のタブで旧データが開かれています。ほかのFinanceタブを閉じてください。'));
  });
}
