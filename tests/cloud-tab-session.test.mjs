import test from 'node:test';
import assert from 'node:assert/strict';
import {readTabSession, saveTabSession, clearTabSession, TAB_SESSION_KEY, TAB_SESSION_TTL_MS} from '../dist/src/cloud/tab-session.js';
import {LiveVault} from '../dist/src/cloud/live-vault.js';

const clientId = '78a9834b-ab02-4123-ad31-37ad28ee2050';
const salt = btoa(String.fromCharCode(...new Uint8Array(16).fill(15)));
const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(23)));
const storage=()=>{
  const data=new Map();
  return {
    getItem:key=>data.get(key)??null,
    setItem:(key,value)=>data.set(key,value),
    removeItem:key=>data.delete(key),
  };
};
test('temporary tab key is opt-in, bound to Client ID and expires after two hours',()=>{
  const s=storage();
  assert.equal(readTabSession(s,clientId),null);
  saveTabSession(s,clientId,salt,secret,1234);
  assert.equal(readTabSession(s,clientId,1234).key,secret);
  assert.equal(readTabSession(s,clientId,1234+TAB_SESSION_TTL_MS-1).salt,salt);
  assert.equal(readTabSession(s,clientId,1234+TAB_SESSION_TTL_MS),null);
  assert.equal(s.getItem(TAB_SESSION_KEY),null);
});
test('invalid, mixed-account and corrupt tab keys are removed, and explicit lock clears the key',()=>{
  const s=storage();
  assert.throws(()=>saveTabSession(s,clientId,salt,'not a key'),/不正/);
  saveTabSession(s,clientId,salt,secret,10);
  assert.equal(readTabSession(s,'1e0a683d-f1cd-4e02-92cd-5bb6e66f762b',10),null);
  assert.equal(s.getItem(TAB_SESSION_KEY),null);
  s.setItem(TAB_SESSION_KEY,'{bad json');
  assert.equal(readTabSession(s,clientId,10),null);
  saveTabSession(s,clientId,salt,secret,10);
  clearTabSession(s);
  assert.equal(readTabSession(s,clientId,11),null);
});

// Minimal Graph-compatible, encrypted index + year-shard mock; exercises the real cloud crypto.
function mockClient(){
  const files=new Map();let revision=0;
  const file=name=>files.get(name)??null;
  const read=name=>{const f=file(name);return f?{...f}:null;};
  const put=(name,text)=>{const data={text,id:name,etag:`"${++revision}"`};files.set(name,data);return data;};
  return {
    files,
    readFinanceIndex:async()=>read('index'),
    readLiveVault:async()=>null,
    writeFinanceIndex:async(text)=>put('index',text),
    listYearFiles:async()=>[],
    ensurePayrollNamespace:async()=>{},
  };
}
test('a real encrypted vault can restore from a tab-only AES key without saving passphrase',async()=>{
  const api=mockClient();
  const source=new LiveVault(api);
  await source.create('my long private 1Password passphrase',true);
  const credential=await source.exportTabKey();
  assert.equal(credential.key.length,44);
  assert.equal(api.files.get('index').text.includes('my long private'),false);
  const s=storage();
  saveTabSession(s,clientId,credential.salt,credential.key);
  const restored=readTabSession(s,clientId);
  const tab=new LiveVault(api);
  await tab.unlockTab(restored.salt,restored.key);
  assert.equal(tab.unlocked,true);
  assert.deepEqual(tab.records(),[]);
  // Invalid key must fail authentication, rather than opening an incorrect vault.
  const changed=secret;
  await assert.rejects(new LiveVault(api).unlockTab(restored.salt,changed),/パスフレーズ|破損/);
  tab.lock();clearTabSession(s);
  assert.equal(tab.unlocked,false);
  assert.equal(readTabSession(s,clientId),null);
});
