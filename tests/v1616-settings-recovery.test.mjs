import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OneDriveTestClient} from '../dist/src/cloud/onedrive-api.js';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ts=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');

test('v1.6.16: payroll is collapsible and comes immediately above advanced settings',()=>{
  const settings=html.split('id="settings-view"')[1].split('<footer>')[0];
  const nisa=settings.indexOf('id="settings-nisa-panel"');
  const payroll=settings.indexOf('id="settings-payroll-disclosure"');
  const advanced=settings.indexOf('id="cloud-advanced"');
  assert.ok(nisa>=0&&nisa<payroll&&payroll<advanced);
  assert.match(settings,/<details class="panel assets-payroll-panel settings-payroll-disclosure"/);
  assert.match(settings,/<summary class="settings-payroll-summary">/);
  assert.ok(!/<details class="panel assets-payroll-panel[^>]*\bopen\b/.test(settings));
  for(const id of ['assets-payroll-connect','assets-payroll-deposit-form','assets-payroll-summary','cloud-advanced'])
    assert.equal(settings.split(`id="${id}"`).length,2);
});

test('v1.6.16: pending recovery uses an explicit button and no browser storage',()=>{
  assert.match(html,/id="cloud-resume-batch"[^>]*class="secondary-action hidden"/);
  assert.match(ts,/resumePendingYearBatch\(\)/);
  const src=readFileSync(new URL('../src/cloud/live-vault.ts',import.meta.url),'utf8');
  assert.match(src,/private pendingYearBatch/);
  assert.doesNotMatch(src,/localStorage\.setItem\(['"]pendingYearBatch/);
});

test('v1.6.16: reads time out even after GET headers arrive',async()=>{
  const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(fn,delay,...args)=>originalTimeout(fn,delay===30000?20:delay,...args);
  let aborted=false;
  const client=new OneDriveTestClient('test-only',async(_url,init)=>{
    init.signal?.addEventListener('abort',()=>{aborted=true;});
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('partial'));}}),{status:200});
  });
  try{
    await assert.rejects(client.httpWithReadTimeout('https://graph.microsoft.com/test',{method:'GET'}),/30秒/);
    assert.equal(aborted,true);
  }finally{globalThis.setTimeout=originalTimeout;}
});

test('v1.6.16: stalled signed download is subject to whole-body deadline, without bearer token',async()=>{
  const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(fn,delay,...args)=>originalTimeout(fn,delay===30000?20:delay,...args);
  let signedAuth;
  const client=new OneDriveTestClient('test-only',async(url,init)=>{
    if(url==='https://test.example/download'){
      signedAuth=init.headers?.Authorization;
      return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('half'));}}),{status:200});
    }
    return Response.json({id:'asset',eTag:'"1"','@microsoft.graph.downloadUrl':'https://test.example/download'});
  });
  try{
    await assert.rejects(client.downloadItemInfo('asset',1000),/30秒/);
    assert.equal(signedAuth,undefined);
  }finally{globalThis.setTimeout=originalTimeout;}
});
