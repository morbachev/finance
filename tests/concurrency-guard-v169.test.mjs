import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {LiveVault,CloudWriteUncertainError} from '../dist/src/cloud/live-vault.js';
import {GraphError} from '../dist/src/cloud/onedrive-api.js';
import {emptyDocument,detectDocumentEditCollisions} from '../dist/src/cloud/merge.js';
import {emptyRules,detectRuleEditCollisions} from '../dist/src/cloud/merchant-rules.js';
import {emptyAssets,describeAssetsEditCollisions,detectAssetsEditCollisions} from '../dist/src/cloud/assets.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const password='only-test-credentials-a-long-password';
const statement=(amount=100,merchant='Shop',month='2026-11')=>({provider:'rakuten',cardId:'rakuten-mizuho',sourceKind:'paste',sourceName:'paste',billingMonth:month,paymentDate:null,statedTotal:amount,confirmation:'confirmed',warnings:[],rows:[{id:'row-a',usedOn:'2026-11-18',merchant,amount},{id:'row-b',usedOn:'2026-11-17',merchant:'Other',amount:0}]});
const rule=(displayName='Base',pattern='SHOP',id='rule-a')=>({id,pattern,displayName,mode:'contains',cardId:null,enabled:true,priority:100});
const bucket=year=>`year:${year}`;
class Graph {
  constructor(state){this.state=state;this.failNextList=false;this.failYear=null;}
  read(name){const f=this.state.get(name);return f?{text:f.text,id:name,etag:`"${f.rev}"`}:null;}
  write(name,text,ref){const old=this.state.get(name);
    if(old?(!ref||ref.etag!==`"${old.rev}"`):!!ref)throw new GraphError(412,'etags differ');
    const rev=(old?.rev??0)+1;this.state.set(name,{text,rev});return {id:name,etag:`"${rev}"`};
  }
  async readFinanceIndex(){return this.read('index');}
  async writeFinanceIndex(t,r){return this.write('index',t,r);}
  async readLiveVault(){return null;}
  async ensurePayrollNamespace(){}
  async listYearFiles(){if(this.failNextList){this.failNextList=false;throw new Error('refresh failed after commit');}
    return [...this.state.keys()].filter(x=>x.startsWith('year:')).map(x=>({year:x.slice(5),id:x,etag:this.read(x).etag}));}
  async readYearVault(year){return this.read(bucket(year));}
  async writeYearVault(year,t,r){if(year===this.failYear)throw new Error('temporary year failure');return this.write(bucket(year),t,r);}
  async readMerchantRules(){return this.read('rules');}
  async writeMerchantRules(t,r){return this.write('rules',t,r);}
  async readAssetSettings(){return this.read('assets');}
  async writeAssetSettings(t,r){return this.write('assets',t,r);}
}
async function pair(){const state=new Map(),aGraph=new Graph(state),bGraph=new Graph(state);
 const a=new LiveVault(aGraph),b=new LiveVault(bGraph);await a.create(password);return {state,a,b,aGraph,bGraph};}

test('detects same-row amount, date and delete/edit; independent row edits stay mergeable',()=>{
 const base={...emptyDocument(),records:[{id:'stmt',statement:statement()}]},left=structuredClone(base),right=structuredClone(base);
 left.records[0].statement.rows[0].amount=120;
 right.records[0].statement.rows[1].usedOn='2026-11-16';
 assert.deepEqual(detectDocumentEditCollisions(base,left,right),[]);
 right.records[0].statement.rows[0].amount=150;
 assert.deepEqual(detectDocumentEditCollisions(base,left,right).map(x=>x.path),['record.statement.rows[row-a].amount']);
 left.records=[];left.deleted=['stmt'];
 assert.deepEqual(detectDocumentEditCollisions(base,left,right).map(x=>x.path),['record']);
});

test('cloud statement concurrent edit stops before write, then prompts and can approve',async()=>{
 const {a,b,state}=await pair();
 await a.saveBatch([{id:'stmt',statement:statement()}]);
 await b.unlock(password);
 await a.saveBatch([{id:'stmt',statement:statement(120)}]);
 const before=state.get(bucket('2026'));
 await assert.rejects(b.saveBatch([{id:'stmt',statement:statement(150)}]),/別端末|同時編集|停止しました/);
 assert.equal(state.get(bucket('2026')),before);
 let calls=0;
 b.setStatementConflictResolver(items=>{calls++;assert.equal(items[0].recordId,'stmt');assert.ok(items.some(item=>item.path==='record.statement.rows[row-a].amount'));return false;});
 await assert.rejects(b.saveBatch([{id:'stmt',statement:statement(150)}]),/保存を中止/);
 assert.equal(state.get(bucket('2026')),before);
 b.setStatementConflictResolver(()=>true);
 await b.saveBatch([{id:'stmt',statement:statement(150)}]);
 assert.equal(calls,1);
 const c=new LiveVault(new Graph(state));await c.unlock(password);
 assert.equal(c.records()[0].statement.rows[0].amount,150);
});

test('independent statement changes auto-merge without prompting, even within one record',async()=>{
 const {a,b,state}=await pair();await a.saveBatch([{id:'stmt',statement:statement()}]);await b.unlock(password);
 const aEntry=a.records()[0].statement;aEntry.paymentDate='2026-11-27';await a.saveBatch([{id:'stmt',statement:aEntry}]);
 b.setStatementConflictResolver(()=>{throw new Error('should not ask');});
 const bEntry=b.records()[0].statement;bEntry.rows[1].amount=42;
 await b.saveBatch([{id:'stmt',statement:bEntry}]);
 const c=new LiveVault(new Graph(state));await c.unlock(password);
 assert.equal(c.records()[0].statement.paymentDate,'2026-11-27');
 assert.equal(c.records()[0].statement.rows[1].amount,42);
});

test('rule and category same-field changes need approval, other updates continue',async()=>{
 const {a,b,state}=await pair();await a.upsertMerchantRule(rule());await b.unlock(password);
 await a.upsertMerchantRule(rule('Mac'));
 const prior=state.get('rules');
 await assert.rejects(b.upsertMerchantRule(rule('Galaxy')),/別端末|停止しました/);
 assert.equal(state.get('rules'),prior);
 b.setRuleConflictResolver(items=>{assert.equal(items[0].field,'displayName');return false;});
 await assert.rejects(b.upsertMerchantRule(rule('Galaxy')),/中止/);
 assert.equal(state.get('rules'),prior);
 b.setRuleConflictResolver(()=>true);
 await b.upsertMerchantRule(rule('Galaxy'));
 const c=new LiveVault(new Graph(state));await c.unlock(password);
 assert.equal(c.merchantRules()[0].displayName,'Galaxy');
 await c.upsertCategory({id:'food',name:'食費A',color:'orange'});
 const d=new LiveVault(new Graph(state));await d.unlock(password);
 await c.upsertCategory({id:'food',name:'食費B',color:'orange'});
 await assert.rejects(d.upsertCategory({id:'food',name:'食費C',color:'orange'}),/別端末|停止しました/);
});

test('rule collisions match exact field; independent rule changes are harmless',()=>{
 const base={...emptyRules(),rules:[rule()]},left=structuredClone(base),right=structuredClone(base);
 left.rules[0].displayName='A';right.rules[0].priority=99;
 assert.deepEqual(detectRuleEditCollisions(base,left,right),[]);
 right.rules[0].displayName='B';
 assert.deepEqual(detectRuleEditCollisions(base,left,right).map(x=>x.field),['displayName']);
});

test('a confirmed year write followed by refresh outage is success-with-warning, not failure',async()=>{
 const {a,b,state,aGraph}=await pair();await a.saveBatch([{id:'stmt',statement:statement()}]);
 aGraph.failNextList=true;
 const ids=await a.saveBatch([{id:'stmt',statement:statement(199)}]);
 assert.deepEqual(ids,['stmt']);
 assert.match(a.takeMutationWarning(),/保存は確認できました/);
 const c=new LiveVault(new Graph(state));await c.unlock(password);assert.equal(c.records()[0].statement.rows[0].amount,199);
 await b.unlock(password);
 aGraph.failNextList=true;
 await a.delete('stmt');
 assert.match(a.takeMutationWarning(),/削除は確認できました/);
 await b.refresh();assert.equal(b.records().length,0);
});

test('multi-year save with later failure reports outcome unknown, not definite failure',async()=>{
 const {a,state,aGraph}=await pair();aGraph.failYear='2027';
 await assert.rejects(a.saveBatch([
  {id:'first',statement:statement(100,'one','2026-11')},
  {id:'second',statement:statement(200,'two','2027-01')},
 ]),CloudWriteUncertainError);
 assert.ok(state.has(bucket('2026')));
});

test('asset conflict details show record/date and values, but redact credentials',()=>{
 const base={...emptyAssets(),oneTime:[{id:'once-test-a',date:'2026-11-18',name:'食費',amount:3000,kind:'expense',status:'done',fromAccountId:'rakuten-bank',toAccountId:null}]};
 const local=structuredClone(base),remote=structuredClone(base);
 local.oneTime[0].amount=4000;remote.oneTime[0].amount=5000;
 const collisions=detectAssetsEditCollisions(base,local,remote);
 const details=describeAssetsEditCollisions(base,local,remote,collisions);
 assert.equal(details[0].label,'2026-11-18・食費');
 assert.equal(details[0].localValue,'4,000円');assert.equal(details[0].remoteValue,'5,000円');
 const secret1={...emptyAssets(),payrollAutoPassphrase:'SENSITIVE SECRET A'},secret2={...emptyAssets(),payrollAutoPassphrase:'SENSITIVE SECRET B'};
 const hidden=describeAssetsEditCollisions(emptyAssets(),secret1,secret2,detectAssetsEditCollisions(emptyAssets(),secret1,secret2));
 assert.equal(JSON.stringify(hidden).includes('SENSITIVE SECRET'),false);
});

test('form dirty guards are independent and included in beforeunload tracking',async()=>{
 const ui=await readFile(new URL('../src/ui/assets-settings.ts',import.meta.url),'utf8');
 assert.match(ui,/let cardDebitAccountsDirty=false,mizuhoPlanDirty=false/);
 assert.match(ui,/if\(!mizuhoPlanDirty\)/);
 assert.match(ui,/'mizuho-plan-form'\)\.addEventListener\('input'/);
 assert.doesNotMatch(ui,/setMizuhoTransferPlan\(plan\);\s*cardDebitAccountsDirty=false/);
 assert.match(ui,/isDirty:\(\)=>[^;]*cardDebitAccountsDirty\|\|mizuhoPlanDirty/);
});

test('explicit approval honors local deletion against a remote edited statement',async()=>{
 const {a,b,state}=await pair();await a.saveBatch([{id:'stmt',statement:statement()}]);await b.unlock(password);
 await a.saveBatch([{id:'stmt',statement:statement(120)}]);
 b.setStatementConflictResolver(items=>{assert.ok(items.some(c=>c.path==='record'));return true;});
 await b.delete('stmt');
 const c=new LiveVault(new Graph(state));await c.unlock(password);assert.equal(c.records().length,0);
});

test('explicit approval honors local rule and asset deletion against remote edits',async()=>{
 const {a,b,state}=await pair();await a.upsertMerchantRule(rule());await b.unlock(password);
 await a.upsertMerchantRule(rule('Mac'));
 b.setRuleConflictResolver(items=>{assert.ok(items.some(c=>c.field==='rule'));return true;});
 await b.removeMerchantRule('rule-a');
 const c=new LiveVault(new Graph(state));await c.unlock(password);assert.equal(c.merchantRules().length,0);
 const once={id:'once-test-a',date:'2026-11-18',name:'test',amount:1000,kind:'expense',status:'done',fromAccountId:'rakuten-bank',toAccountId:null};
 await a.upsertOneTime(once);await b.refresh();
 await a.upsertOneTime({...once,name:'Changed'});
 b.setAssetConflictResolver(items=>{assert.equal(items[0].field,'delete');return true;});
 await b.deleteOneTime(once.id);
 const d=new LiveVault(new Graph(state));await d.unlock(password);assert.equal(d.assetSettings().oneTime.length,0);
});

test('a prior confirmed year plus a cancelled collision is classified as partial/uncertain',async()=>{
 const {a,b,state}=await pair();
 await a.saveBatch([{id:'older',statement:statement(100,'a','2027-01')}]);
 await b.unlock(password);
 await a.saveBatch([{id:'older',statement:statement(120,'a','2027-01')}]);
 b.setStatementConflictResolver(()=>false);
 await assert.rejects(b.saveBatch([
  {id:'other',statement:statement(100,'new','2026-01')},
  {id:'older',statement:statement(140,'a','2027-01')},
 ]),error=>error instanceof CloudWriteUncertainError&&/保存済みの可能性/.test(error.message));
 assert.ok(state.has(bucket('2026')));
});

test('concurrent edits to a category definition detect name conflict, independent colors merge',()=>{
 const base={...emptyRules(),categoryDefinitions:[{id:'food',name:'Food',color:'orange'}]};
 const left=structuredClone(base),right=structuredClone(base);
 left.categoryDefinitions[0].name='食費';right.categoryDefinitions[0].color='teal';
 assert.deepEqual(detectRuleEditCollisions(base,left,right),[]);
 right.categoryDefinitions[0].name='外食';
 assert.deepEqual(detectRuleEditCollisions(base,left,right).map(c=>c.field),['name']);
});
