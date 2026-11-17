import test from 'node:test';
import assert from 'node:assert/strict';
import {freshSalt,deriveCloudKey,encryptDocument,decryptDocument,encryptOriginal,decryptOriginal,parseEnvelope} from '../dist/src/cloud/cloud-crypto.js';
import {emptyDocument} from '../dist/src/cloud/merge.js';
test('separate live vault encrypt/decrypt with no plaintext visible in envelope',async()=>{
  const salt=freshSalt(),key=await deriveCloudKey('1password-長いパスフレーズ',salt);
  const doc=emptyDocument();doc.records.push({id:'a',statement:{provider:'rakuten',cardId:'rakuten-etc',sourceKind:'paste',sourceName:'機密名称',billingMonth:'2026-10',paymentDate:null,statedTotal:0,confirmation:'confirmed',rows:[],warnings:[]}});
  const text=await encryptDocument(doc,key,salt);
  assert.ok(!text.includes('機密名称'));
  const restored=await decryptDocument(parseEnvelope(text),key);
  assert.deepEqual(restored,doc);
  await assert.rejects(decryptDocument(parseEnvelope(text),await deriveCloudKey('wrong-password',salt)),/パスフレーズ/);
});
test('separate original PDF encryption preserves binary byte identity',async()=>{
  const key=await deriveCloudKey('a sufficiently long pass',freshSalt());
  const source=new Uint8Array([37,80,68,70,0,255,1,2,3,4]);
  const text=await encryptOriginal(source,key);
  assert.deepEqual(await decryptOriginal(text,key),source);
  const tampered=JSON.parse(text);tampered.data='AAAA'+tampered.data.slice(4);
  await assert.rejects(decryptOriginal(JSON.stringify(tampered),key));
});
