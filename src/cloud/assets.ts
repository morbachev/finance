/** Finance assets settings are independent from statements and merchant rules.
 * Snapshots are confirmed balances, not reconstructed transactions. */
export const ASSET_ACCOUNTS = [
  {id:'rakuten-bank', name:'楽天銀行', detail:'生活費・カード引落など', icon:'🏦'},
  {id:'cash-savings', name:'現金貯金専用口座', detail:'楽天銀行から定期送金', icon:'🐖'},
  {id:'nisa', name:'NISA口座', detail:'積立投資の評価額', icon:'🌱'},
] as const;
export type AssetAccountId = typeof ASSET_ACCOUNTS[number]['id'];
export type RecurringKind = 'expense' | 'income' | 'transfer';
export type RecurringFrequency = 'monthly' | 'yearly' | 'weekly';
/** Explicit opt-in; only positive card rows with this card/merchant are treated as NISA contributions. */
export interface NisaCardRule {cardId:string;merchantContains:string;enabled:boolean}
export interface BalanceSnapshot {
  id: string;
  accountId: AssetAccountId;
  balance: number; // JPY, integer. NISA values are manually confirmed valuations.
  observedAt: string; // ISO timestamp with time zone, captured at confirmation.
}
export interface RecurringEntry {
  id: string;
  name: string;
  amount: number;
  kind: RecurringKind;
  fromAccountId: AssetAccountId | null;
  toAccountId: AssetAccountId | null;
  frequency: RecurringFrequency;
  dayOfMonth: number | null; // 0 = end of month; 1-31 = day (clamped to month end in future projections).
  monthOfYear: number | null; // 1-12, yearly only.
  weekday: number | null; // 0 Sun - 6 Sat, weekly only.
  startOn: string;
  endOn: string | null;
  categoryId: string | null; // Display metadata only; not used for projection in v1.2.4.
  enabled: boolean;
}
export interface AssetsConflict {itemId:string;field:string;discarded:unknown;chosen:unknown;at:string}
export interface AssetsDocument {
  format: 'finance-assets-v1';
  snapshots: BalanceSnapshot[];
  recurring: RecurringEntry[];
  deletedSnapshots: string[];
  deletedRecurring: string[];
  conflicts: AssetsConflict[];
  nisaCardRule: NisaCardRule | null;
  payrollDepositAccount: AssetAccountId | null;
  /** Opt-in only. Stored exclusively inside AES-GCM encrypted finance/settings/assets.enc. */
  payrollAutoPassphrase: string | null;
}
export function emptyAssets(): AssetsDocument {
  return {format:'finance-assets-v1',snapshots:[],recurring:[],deletedSnapshots:[],deletedRecurring:[],conflicts:[],nisaCardRule:null,payrollDepositAccount:null,payrollAutoPassphrase:null};
}
const accountIds = new Set<string>(ASSET_ACCOUNTS.map(a=>a.id));
const idPattern = /^[a-zA-Z0-9-]{6,80}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const clone = <T>(value:T):T => structuredClone(value);
const same = (left:unknown,right:unknown):boolean => JSON.stringify(left)===JSON.stringify(right);
function validateDate(value:unknown): value is string {
  if(typeof value!=='string'||!datePattern.test(value))return false;
  const date=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function checkAccount(value:unknown):value is AssetAccountId{return typeof value==='string'&&accountIds.has(value);}
export function validateSnapshot(raw:BalanceSnapshot):BalanceSnapshot {
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!idPattern.test(raw.id)||
     !checkAccount(raw.accountId)||!Number.isSafeInteger(raw.balance)||raw.balance<0||
     typeof raw.observedAt!=='string'||raw.observedAt.length>40||
     !/^\d{4}-\d{2}-\d{2}T/.test(raw.observedAt)||
     !Number.isFinite(Date.parse(raw.observedAt))|| !/(Z|[+-]\d{2}:\d{2})$/.test(raw.observedAt))
    throw new Error('口座残高の記録が不正です。金額と確認日時を確認してください。');
  return {id:raw.id,accountId:raw.accountId,balance:raw.balance,observedAt:new Date(raw.observedAt).toISOString()};
}
export function validateRecurring(raw:RecurringEntry):RecurringEntry {
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!idPattern.test(raw.id)||
    typeof raw.name!=='string'||!raw.name.trim()||raw.name.trim().length>80||
    !Number.isSafeInteger(raw.amount)||raw.amount<=0||
    !(['expense','income','transfer'] as unknown[]).includes(raw.kind)||
    (raw.fromAccountId!==null&&!checkAccount(raw.fromAccountId))||
    (raw.toAccountId!==null&&!checkAccount(raw.toAccountId))||
    !(['monthly','yearly','weekly'] as unknown[]).includes(raw.frequency)||
    !validateDate(raw.startOn)||(raw.endOn!==null&&!validateDate(raw.endOn))||
    (raw.endOn!==null&&raw.endOn<raw.startOn)||
    (raw.categoryId!==null && (typeof raw.categoryId!=='string'||raw.categoryId.length>90||!/^[a-z0-9-]+$/.test(raw.categoryId)))||
    typeof raw.enabled!=='boolean')throw new Error('定期入出金の登録内容が不正です。');
  if(raw.kind==='expense' && (!checkAccount(raw.fromAccountId)||raw.toAccountId!==null))throw new Error('支出の引落元口座を指定してください。');
  if(raw.kind==='income' && (!checkAccount(raw.toAccountId)||raw.fromAccountId!==null))throw new Error('収入の入金先口座を指定してください。');
  if(raw.kind==='transfer' && (!checkAccount(raw.fromAccountId)||!checkAccount(raw.toAccountId)||raw.fromAccountId===raw.toAccountId))throw new Error('振替元と振替先は別の口座を指定してください。');
  if(raw.frequency==='weekly'){
    if(!Number.isInteger(raw.weekday)||raw.weekday===null||raw.weekday<0||raw.weekday>6||raw.dayOfMonth!==null||raw.monthOfYear!==null)throw new Error('毎週の曜日設定が不正です。');
  }else{
    if(!Number.isInteger(raw.dayOfMonth)||raw.dayOfMonth===null||raw.dayOfMonth<0||raw.dayOfMonth>31||raw.weekday!==null||
       (raw.frequency==='monthly' ? raw.monthOfYear!==null : !Number.isInteger(raw.monthOfYear)||raw.monthOfYear===null||raw.monthOfYear<1||raw.monthOfYear>12))
      throw new Error('定期入出金の日付設定が不正です。');
  }
  return {...raw,name:raw.name.trim()};
}
export function validateNisaCardRule(raw:unknown):NisaCardRule|null {
  if(raw==null)return null; // Existing finance-assets-v1 documents remain readable.
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('NISAのカード積立連携設定が不正です。');
  const rule=raw as NisaCardRule;
  if(typeof rule.cardId!=='string'||!rule.cardId||rule.cardId.length>80||
    typeof rule.merchantContains!=='string'||rule.merchantContains.trim().length<3||rule.merchantContains.trim().length>90||
    typeof rule.enabled!=='boolean')throw new Error('NISAのカード積立連携設定が不正です。');
  return {cardId:rule.cardId,merchantContains:rule.merchantContains.trim(),enabled:rule.enabled};
}
export function validatePayrollDepositAccount(raw:unknown):AssetAccountId|null {
  if(raw===undefined||raw===null)return null;
  if(!checkAccount(raw)||raw==='nisa')throw new Error('給与の受取口座の設定が不正です。');
  return raw;
}
/** Preserve the exact secret, including whitespace, for the Payroll PBKDF2 derivation. */
export function validatePayrollAutoPassphrase(raw:unknown):string|null {
  if(raw===null||raw===undefined)return null;
  if(typeof raw!=='string'||[...raw].length<12||[...raw].length>1024)
    throw new Error('Payrollの自動連携用パスフレーズの形式が不正です。');
  return raw;
}
export function validateAssets(raw:unknown):AssetsDocument {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('資産設定の暗号データが不正です。');
  const doc=raw as AssetsDocument;
  if(doc.format!=='finance-assets-v1'||!Array.isArray(doc.snapshots)||!Array.isArray(doc.recurring)||
    !Array.isArray(doc.deletedSnapshots)||!Array.isArray(doc.deletedRecurring)||!Array.isArray(doc.conflicts)||
    doc.snapshots.length>1000||doc.recurring.length>300||doc.deletedSnapshots.length>2500||doc.deletedRecurring.length>2500||doc.conflicts.length>300)
    throw new Error('資産設定の形式または件数が不正です。');
  const snapshots=doc.snapshots.map(validateSnapshot),recurring=doc.recurring.map(validateRecurring);
  for(const list of [snapshots,recurring]){
    const ids=new Set<string>();for(const item of list){if(ids.has(item.id))throw new Error('資産設定の識別子が重複しています。');ids.add(item.id);}
  }
  const checkDeleted=(ids:string[])=>{
    if(ids.some(x=>typeof x!=='string'||!idPattern.test(x)))throw new Error('削除済み設定の形式が不正です。');
    return [...new Set(ids)];
  };
  const deletedSnapshots=checkDeleted(doc.deletedSnapshots),deletedRecurring=checkDeleted(doc.deletedRecurring);
  if(snapshots.some(s=>deletedSnapshots.includes(s.id))||recurring.some(s=>deletedRecurring.includes(s.id)))throw new Error('削除済み設定と有効な設定が重複しています。');
  if(doc.conflicts.some(c=>!c||typeof c.itemId!=='string'||!idPattern.test(c.itemId)||typeof c.field!=='string'||c.field.length>50||typeof c.at!=='string'||!Number.isFinite(Date.parse(c.at))))
    throw new Error('資産設定の競合履歴が不正です。');
  return {format:'finance-assets-v1',snapshots,recurring,deletedSnapshots,deletedRecurring,conflicts:clone(doc.conflicts),nisaCardRule:validateNisaCardRule(doc.nisaCardRule),payrollDepositAccount:validatePayrollDepositAccount(doc.payrollDepositAccount),
    payrollAutoPassphrase:validatePayrollAutoPassphrase(doc.payrollAutoPassphrase)};
}
export function latestBalance(doc:AssetsDocument,account:AssetAccountId,asOf?:string):BalanceSnapshot|null {
  const found=doc.snapshots.filter(s=>s.accountId===account&&(!asOf||s.observedAt<=asOf));
  return found.sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||b.id.localeCompare(a.id))[0]??null;
}
/** Merge independent additions, removals and field edits from two devices. Concurrent
 * same-field edits prefer the saving device and retain the other value in encrypted audit. */
export function mergeAssets(base:AssetsDocument,local:AssetsDocument,remote:AssetsDocument,now=new Date().toISOString()):AssetsDocument {
  const conflicts=[...remote.conflicts];
  for(const c of local.conflicts)if(!conflicts.some(x=>same(x,c)))conflicts.push(clone(c));
  const mergeGroup=<T extends {id:string}>(b:T[],l:T[],r:T[],bDeleted:string[],lDeleted:string[],rDeleted:string[],fields:(keyof T)[])=>{
    const bm=new Map(b.map(x=>[x.id,x])),lm=new Map(l.map(x=>[x.id,x])),rm=new Map(r.map(x=>[x.id,x]));
    const deleted=new Set([...bDeleted,...lDeleted,...rDeleted]);const entries:T[]=[];
    for(const id of new Set([...bm.keys(),...lm.keys(),...rm.keys(),...deleted])){
      const bv=bm.get(id),lv=lm.get(id),rv=rm.get(id);
      if(lDeleted.includes(id)&&(!rv||same(bv,rv))){deleted.add(id);continue;}
      if(rDeleted.includes(id)&&(!lv||same(bv,lv))){deleted.add(id);continue;}
      if(lDeleted.includes(id)&&rv&&!same(rv,bv)){
        conflicts.push({itemId:id,field:'delete',discarded:'削除',chosen:clone(rv),at:now});entries.push(clone(rv));deleted.delete(id);continue;
      }
      if(rDeleted.includes(id)&&lv&&!same(lv,bv)){
        conflicts.push({itemId:id,field:'delete',discarded:'削除',chosen:clone(lv),at:now});entries.push(clone(lv));deleted.delete(id);continue;
      }
      if(!lv&&!rv)continue;
      if(!lv&&rv){entries.push(clone(rv));deleted.delete(id);continue;}
      if(!rv&&lv){entries.push(clone(lv));deleted.delete(id);continue;}
      if(!lv||!rv)continue;
      const merged={id} as Record<string,unknown>;
      for(const k of fields){
        if(k==='id')continue;
        const key=String(k),baseline=bv?.[k],left=lv[k],right=rv[k];
        if(same(left,baseline))merged[key]=clone(right);
        else if(same(right,baseline)||same(left,right))merged[key]=clone(left);
        else{merged[key]=clone(left);conflicts.push({itemId:id,field:key,discarded:clone(right),chosen:clone(left),at:now});}
      }
      entries.push(merged as T);deleted.delete(id);
    }
    return {entries,deleted:[...deleted]};
  };
  const snapshots=mergeGroup(base.snapshots,local.snapshots,remote.snapshots,base.deletedSnapshots,local.deletedSnapshots,remote.deletedSnapshots,
    ['accountId','balance','observedAt']);
  const recurring=mergeGroup(base.recurring,local.recurring,remote.recurring,base.deletedRecurring,local.deletedRecurring,remote.deletedRecurring,
    ['name','amount','kind','fromAccountId','toAccountId','frequency','dayOfMonth','monthOfYear','weekday','startOn','endOn','categoryId','enabled']);
  const baseline=base.nisaCardRule??null,left=local.nisaCardRule??null,right=remote.nisaCardRule??null;
  let nisaCardRule: NisaCardRule | null;
  if(same(left,baseline))nisaCardRule=clone(right);
  else if(same(right,baseline)||same(left,right))nisaCardRule=clone(left);
  else{
    nisaCardRule=clone(left);
    conflicts.push({itemId:'nisa-card-rule',field:'nisaCardRule',discarded:clone(right),chosen:clone(left),at:now});
  }
  const oldAccount=base.payrollDepositAccount??null,localAccount=local.payrollDepositAccount??null,remoteAccount=remote.payrollDepositAccount??null;
  let payrollDepositAccount:AssetAccountId|null;
  if(same(localAccount,oldAccount))payrollDepositAccount=remoteAccount;
  else if(same(remoteAccount,oldAccount)||same(localAccount,remoteAccount))payrollDepositAccount=localAccount;
  else {
    payrollDepositAccount=localAccount;
    conflicts.push({itemId:'payroll-deposit-account',field:'payrollDepositAccount',discarded:remoteAccount,chosen:localAccount,at:now});
  }
  const previousSecret=base.payrollAutoPassphrase??null;
  const localSecret=local.payrollAutoPassphrase??null;
  const remoteSecret=remote.payrollAutoPassphrase??null;
  let payrollAutoPassphrase:string|null;
  if(same(localSecret,previousSecret))payrollAutoPassphrase=remoteSecret;
  else if(same(remoteSecret,previousSecret)||same(localSecret,remoteSecret))payrollAutoPassphrase=localSecret;
  else {
    payrollAutoPassphrase=localSecret;
    // Never put either old or new credential into the permanent conflict log.
    conflicts.push({itemId:'payroll-auto-credential',field:'payrollAutoPassphrase',discarded:'競合',chosen:'保存端末側を優先',at:now});
  }
  return validateAssets({format:'finance-assets-v1',snapshots:snapshots.entries,recurring:recurring.entries,
    deletedSnapshots:snapshots.deleted,deletedRecurring:recurring.deleted,conflicts:conflicts.slice(-200),nisaCardRule,payrollDepositAccount,payrollAutoPassphrase});
}
