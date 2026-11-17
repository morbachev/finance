import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault, hasVault, isUnlocked, lockVault, unlockVault, saveStatement,
  readStatements, readOriginal, deleteSaved, exportEncryptedBackup,
} from '../dist/src/storage/encrypted-vault.js';

// A small in-memory IDB test double exercises real WebCrypto + the storage API.
// Browser IndexedDB integration still needs validation in Chrome/Safari.
function makeFakeIndexedDb() {
  const stores = new Map();
  const db = {
    objectStoreNames: { contains(name) { return stores.has(name); } },
    createObjectStore(name) { stores.set(name, new Map()); },
    transaction(names) {
      const txn = { oncomplete: null, onerror: null, onabort: null, error: null,
        objectStore(name) {
          assert(stores.has(name));
          const store = stores.get(name);
          const makeReq = (callback) => {
            const req = { result: undefined, onsuccess: null, onerror: null, error: null };
            setTimeout(() => { req.result = callback(); req.onsuccess?.(); }, 0);
            return req;
          };
          return {
            get(k) { return makeReq(() => structuredClone(store.get(k))); },
            getAll() { return makeReq(() => structuredClone([...store.values()])); },
            put(v) {
              store.set(v.id, structuredClone(v));
              setTimeout(() => txn.oncomplete?.(), 0);
            },
            delete(k) { store.delete(k); setTimeout(() => txn.oncomplete?.(), 0); },
          };
        },
      };
      return txn;
    },
  };
  return {
    stores,
    open() {
      const request = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, error: null };
      setTimeout(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }, 0);
      return request;
    },
  };
}

test('encrypted IndexedDB: create, save, lock, unlock, original, backup and delete', async () => {
  const fake = makeFakeIndexedDb();
  globalThis.indexedDB = fake;
  assert.equal(await hasVault(), false);
  await createVault('passphrase-for-tests-only-1000');
  assert.equal(await hasVault(), true);
  const statement = {
    provider:'smbc', cardId:'amazon', sourceKind:'paste', sourceName:'Web明細の貼り付け',
    billingMonth:'2026-12', paymentDate:'2026-12-28', statedTotal:643, confirmation:'provisional',
    rows:[{id:'row1',usedOn:'2026-11-10',merchant:'テスト店舗',amount:643}], warnings:[],
  };
  const raw = 'サイトからコピーした機微な原文';
  const bytes = new TextEncoder().encode(raw);
  const id = await saveStatement(statement, { bytes, mime: 'text/plain;charset=utf-8' });
  const records = fake.stores.get('statements');
  const stored = records.get(id);
  assert.equal(stored.id, id);
  assert.equal(JSON.stringify(stored).includes('テスト店舗'), false);
  assert.equal(JSON.stringify(stored).includes(raw), false);
  assert.equal((await readStatements()).length, 1);
  const original = await readOriginal(id);
  assert.equal(new TextDecoder().decode(original.bytes), raw);
  lockVault();
  assert.equal(isUnlocked(), false);
  await assert.rejects(() => readStatements(), /ロック/);
  await assert.rejects(() => unlockVault('wrong-passphrase'), /パスフレーズ/);
  await unlockVault('passphrase-for-tests-only-1000');
  assert.equal(isUnlocked(), true);
  assert.equal((await readStatements())[0].statement.rows[0].merchant, 'テスト店舗');
  const backup = await exportEncryptedBackup();
  const exported = await backup.text();
  assert.match(exported, /finance-encrypted-backup-v1/);
  assert.doesNotMatch(exported, /テスト店舗|機微な原文/);
  // A fresh origin can restore the ciphertext-only backup with the same passphrase.
  const freshDb = makeFakeIndexedDb();
  globalThis.indexedDB = freshDb;
  const recovered = await import('../dist/src/storage/encrypted-vault.js?restore-v1');
  const backupFile = new Blob([exported], { type: 'application/json' });
  await assert.rejects(() => recovered.restoreEncryptedBackup(backupFile, 'incorrect-passphrase'), /パスフレーズ/);
  assert.equal(await recovered.hasVault(), false);
  await recovered.restoreEncryptedBackup(backupFile, 'passphrase-for-tests-only-1000');
  assert.equal((await recovered.readStatements()).length, 1);
  assert.equal(new TextDecoder().decode((await recovered.readOriginal(id)).bytes), raw);
  await assert.rejects(() => recovered.restoreEncryptedBackup(backupFile, 'passphrase-for-tests-only-1000'), /既存/);
  await deleteSaved(id);
  assert.equal((await readStatements()).length, 0);
});

test('batch import encrypts both records together: PDF original yes, pasted raw source no', async () => {
  const { createVault, readStatements, readOriginal, saveStatementsBatch } = await import('../dist/src/storage/encrypted-vault.js?batch-v08');
  const fake = makeFakeIndexedDb();
  globalThis.indexedDB = fake;
  await createVault('strong-test-passphrase-088');
  const base = {
    provider:'smbc',cardId:'amazon',sourceKind:'paste',sourceName:'Web paste',
    billingMonth:'2026-12',paymentDate:'2026-12-28',statedTotal:643,confirmation:'provisional',warnings:[],
    rows:[{id:'a',usedOn:'2026-11-02',merchant:'架空の販売店',amount:643}],
  };
  const pdf={...base,provider:'jcb',cardId:'recruit-jcb',sourceKind:'pdf',sourceName:'dummy.pdf'};
  const bytes=new TextEncoder().encode('private PDF test bytes');
  await assert.rejects(() => saveStatementsBatch([{statement:pdf}]), /PDF原本/);
  assert.equal((await readStatements()).length,0);
  const ids=await saveStatementsBatch([{statement:base}, {statement:pdf,source:{bytes,mime:'application/pdf'}}]);
  assert.equal(ids.length,2);
  assert.equal((await readStatements()).length,2);
  assert.equal(await readOriginal(ids[0]),null);
  assert.equal(new TextDecoder().decode((await readOriginal(ids[1])).bytes),'private PDF test bytes');
  const stored=JSON.stringify([...fake.stores.get('statements').values()]);
  assert.doesNotMatch(stored,/架空の販売店|private PDF test bytes/);
  // Updating the paste record cannot accidentally retain v0.7 raw-source copies.
  await saveStatementsBatch([{statement:{...base,rows:[{...base.rows[0],merchant:'修正後の販売店'}]},id:ids[0]}]);
  assert.equal(await readOriginal(ids[0]),null);
});
