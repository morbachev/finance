import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseVaultFiles } from '../dist/src/cloud/vault-diagnostics.js';
import { deriveCloudKey, freshSalt, encryptIndex, encryptDocument, encryptRules, encryptAssets } from '../dist/src/cloud/cloud-crypto.js';
import { emptyDocument } from '../dist/src/cloud/merge.js';
import { emptyRules } from '../dist/src/cloud/merchant-rules.js';
import { emptyAssets } from '../dist/src/cloud/assets.js';

const makeFiles = async () => {
  const salt=freshSalt(),key=await deriveCloudKey('diagnostics-passphrase-for-tests',salt);
  const generation='2002a669-9cb4-41a6-9164-99d5f47f6df7';
  const index=await encryptIndex({format:'finance-cloud-index-v1',years:['2025']},key,salt,generation);
  const year=await encryptDocument(emptyDocument(),key,salt);
  const rules=await encryptRules(emptyRules(),key,salt);
  const assets=await encryptAssets(emptyAssets(),key,salt);
  return {index,year,rules,assets,generation};
};
function mockClient(files) {
  const called=[];
  const client={
    setVaultDataSet(id){called.push(['setVaultDataSet',id]);},
    async readFinanceIndex(){called.push(['readIndex']);return {text:files.index};},
    async listYearFiles(){called.push(['listYearFiles']);return [{year:'2025',id:'secret-file-id',etag:'secret-etag'}];},
    async readYearVault(year){called.push(['readYearVault',year]);return {text:files.year};},
    async readMerchantRules(){called.push(['readRules']);return {text:files.rules};},
    async readAssetSettings(){called.push(['readAssets']);return {text:files.assets};},
  };
  return {client,called};
}

test('read-only diagnosis can check a rotated generation without disclosing content or IDs',async()=>{
  const files=await makeFiles(),{client,called}=mockClient(files);
  const result=await diagnoseVaultFiles(client);
  assert.equal(result.ok,true);
  assert.match(result.report,/暗号化世代：変更後の世代/);
  assert.match(result.report,/2025年の明細：正常/);
  assert.match(result.report,/資産設定：正常/);
  assert.ok(called.some(([op,id])=>op==='setVaultDataSet'&&id===files.generation));
  assert.ok(!called.some(([op])=>op.toLowerCase().startsWith('write')));
  assert.ok(!result.report.includes(files.generation));
  assert.ok(!result.report.includes(files.year));
  assert.ok(!result.report.includes('secret-file-id'));
});
test('read-only diagnosis identifies malformed ciphertext envelope by file type',async()=>{
  const files=await makeFiles();files.year=files.year.slice(0,461)+'x'+files.year.slice(462);
  const {client}=mockClient(files);
  const result=await diagnoseVaultFiles(client);
  // JSON may stay parseable after flipping an encrypted payload character: envelope-only inspection cannot detect this.
  assert.ok(result.report.includes('復号後のJSON'));
  assert.ok(!result.report.includes(files.year));
  files.year='{"format":"finance-cloud-envelope-v1","data":["broken" "json"]}';
  const failure=await diagnoseVaultFiles(client);
  assert.equal(failure.ok,false);
  assert.match(failure.report,/2025年の明細：失敗/);
  assert.match(failure.report,/JSON構文エラー/);
});
test('read-only diagnosis stops safely when index is malformed',async()=>{
  const files=await makeFiles();files.index='{"format":"bad" "salt":"x"}';
  const {client,called}=mockClient(files);
  const result=await diagnoseVaultFiles(client);
  assert.equal(result.ok,false);
  assert.match(result.report,/索引：失敗/);
  assert.ok(!called.some(([op])=>op==='setVaultDataSet'));
});
test('read-only diagnosis reports rule file errors separately',async()=>{
  const files=await makeFiles();files.rules='{"format":"oops"}';
  const result=await diagnoseVaultFiles(mockClient(files).client);
  assert.equal(result.ok,false);
  assert.match(result.report,/利用先ルール：失敗/);
  assert.match(result.report,/資産設定：正常/);
});

test('optional password validates decryption without exposing the key or data',async()=>{
  const files=await makeFiles();
  const correct=await diagnoseVaultFiles(mockClient(files).client,'diagnostics-passphrase-for-tests');
  assert.equal(correct.ok,true);
  assert.match(correct.report,/索引の復号：正常/);
  assert.match(correct.report,/2025年の明細：正常（復号・整合性）/);
  assert.ok(!correct.report.includes('diagnostics-passphrase-for-tests'));
  const wrong=await diagnoseVaultFiles(mockClient(files).client,'wrong password');
  assert.equal(wrong.ok,false);
  assert.match(wrong.report,/索引の復号：失敗/);
});
test('optional password flags corrupted ciphertext that is still valid outer JSON',async()=>{
  const files=await makeFiles();
  const envelope=JSON.parse(files.year);
  envelope.data='AAAA'+envelope.data.slice(4);
  files.year=JSON.stringify(envelope);
  const result=await diagnoseVaultFiles(mockClient(files).client,'diagnostics-passphrase-for-tests');
  assert.equal(result.ok,false);
  assert.match(result.report,/2025年の明細：失敗［復号・整合性エラー］/);
});

test('index-only corruption does not stop independent read-only checks of staged files',async()=>{
  const files=await makeFiles();
  const env=JSON.parse(files.index);
  // Keep the outer JSON valid but invalidate the GCM authentication tag.
  env.data='AAAA'+env.data.slice(4);
  files.index=JSON.stringify(env);
  const {client,called}=mockClient(files);
  const result=await diagnoseVaultFiles(client,'diagnostics-passphrase-for-tests');
  assert.equal(result.ok,false);
  assert.match(result.report,/索引の復号：失敗/);
  assert.match(result.report,/2025年の明細：復号成功（索引と独立して検査）/);
  assert.match(result.report,/利用先ルール：復号成功/);
  assert.match(result.report,/資産設定：復号成功/);
  assert.match(result.report,/索引以外の独立復号：3\/3件成功/);
  assert.match(result.report,/索引だけの不整合を重点調査/);
  assert.ok(!called.some(([method])=>/^(write|upload|delete|create)/i.test(method)));
});

test('wrong password is not falsely presented as evidence of index-only corruption',async()=>{
  const files=await makeFiles();
  const result=await diagnoseVaultFiles(mockClient(files).client,'definitely-wrong-password');
  assert.equal(result.ok,false);
  assert.match(result.report,/索引の復号：失敗/);
  assert.match(result.report,/索引以外の独立復号：0\/3件成功/);
  assert.match(result.report,/入力文字列の相違か暗号データ異常かは未確定/);
  assert.doesNotMatch(result.report,/索引だけの不整合を重点調査/);
});

test('independent file password check uses file salt even if index salt differs',async()=>{
  const files=await makeFiles();
  const env=JSON.parse(files.index);
  env.salt=freshSalt();
  files.index=JSON.stringify(env);
  const result=await diagnoseVaultFiles(mockClient(files).client,'diagnostics-passphrase-for-tests');
  assert.equal(result.ok,false);
  assert.match(result.report,/索引の復号：失敗/);
  assert.match(result.report,/2025年の明細：復号成功.*索引とソルト不一致/);
  assert.match(result.report,/索引以外の独立復号：3\/3件成功/);
});
