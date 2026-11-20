import { showActivity } from './activity-feedback.js';
/** Card subscription suggestions and decisions. All writes are explicit. */
import type { MonthlySource } from '../summary/monthly-summary.js';
import type { LiveVault } from '../cloud/live-vault.js';
import { detectCardSubscriptions, subscriptionDecision, type SubscriptionCandidate } from '../subscriptions/detect.js';
import type {CardRecurringDecision} from '../cloud/assets.js';

export interface SubscriptionsUi {render():void;reset():void;isBusy():boolean}
interface Deps {source():MonthlySource|null;vault():LiveVault|null;onSaved():void;openAccountSettings():void}
const yen=(amount:number)=>`${amount.toLocaleString('ja-JP')}円`;
function el<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text?:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;
}
function button(label:string,click:()=>void,cls='secondary-action'):HTMLButtonElement{
  const node=el('button',cls,label);node.type='button';node.addEventListener('click',click);return node;
}
export function initSubscriptions(deps:Deps):SubscriptionsUi {
  const root=document.getElementById('subscriptions-content');if(!root)throw new Error('定期支出画面が見つかりません。');
  let filter:'candidate'|'registered'|'ignored'='candidate';
  let busy=false,notice='',failed=false;
  function reset():void {filter='candidate';busy=false;notice='';failed=false;root!.replaceChildren();}
  async function update(key:string,decision:CardRecurringDecision|null):Promise<void>{
    const vault=deps.vault();if(busy||!vault?.unlocked)return;
    busy=true;notice='';failed=false;showActivity('定期支出の設定を保存中…','working');render();
    try{await vault.setCardRecurringDecision(key,decision);notice='';showActivity(decision?'定期支出を保存しました。':'候補に戻しました。','good');deps.onSaved();}
    catch(error){notice='';showActivity(error instanceof Error?error.message:'保存に失敗しました','bad');failed=true;}
    finally{busy=false;render();}
  }
  function card(name:string,sub:string,amount:string,description:string,actions:HTMLElement[]):HTMLElement {
    const block=el('article','panel subscriptions-card');
    const header=el('div','subscriptions-card-heading');
    const title=el('div','subscriptions-card-title');title.append(el('strong','',name),el('small','',sub));
    header.append(title,el('strong','subscriptions-amount',amount));block.append(header);
    if(description)block.append(el('p','subscriptions-evidence',description));
    const controls=el('div','subscriptions-actions');for(const action of actions)controls.append(action);block.append(controls);
    return block;
  }
  function render():void {
    root!.replaceChildren();
    const source=deps.source();const vault=deps.vault();
    if(!source||!vault?.unlocked){root!.append(el('p','subscriptions-muted','OneDriveに接続してください。'));return;}
    const candidates=detectCardSubscriptions(source);
    const decisions=source.assets.cardRecurringDecisions??{};
    const pending=candidates.filter(item=>!decisions[item.key]);
    const registered=Object.entries(decisions).filter(([,value])=>value.state==='registered');
    const ignored=Object.entries(decisions).filter(([,value])=>value.state==='ignored');
    const tabs=el('div','subscriptions-tabs');
    for(const [key,label,count] of [['candidate','候補',pending.length],['registered','登録済み',registered.length],['ignored','対象外',ignored.length]] as const){
      const control=button(`${label} ${count}`,()=>{filter=key;notice='';failed=false;render();},'subscriptions-tab'+(filter===key?' selected':''));
      control.setAttribute('aria-pressed',String(filter===key));tabs.append(control);
    }
    root!.append(tabs);
    // Operation feedback uses the shared lower-right activity card.
    const list=el('div','subscriptions-list');
    const details=(item:SubscriptionCandidate)=>`${item.months.length}回 · ${item.months.slice(-4).join(' / ')}${item.months.length>4?' ほか':''} · ${item.minAmount===item.maxAmount?'同額':`${yen(item.minAmount)}〜${yen(item.maxAmount)}`}`;
    if(filter==='candidate'){
      for(const item of pending){
        const actions=[button('登録',()=>{void update(item.key,subscriptionDecision(item,'registered'));},'save-action'),
          button('今回は対象外',()=>{void update(item.key,subscriptionDecision(item,'ignored'));})];
        for(const b of actions)b.disabled=busy;
        list.append(card(item.merchant,`${item.cardName} · ${item.frequency==='monthly'?'毎月':'毎年'}の可能性`,yen(item.amount),details(item),actions));
      }
      if(!pending.length)list.append(el('p','subscriptions-empty','確認が必要な候補はありません。'));
    }else {
      const selected=filter==='registered'?registered:ignored;
      for(const [key,item] of selected){
        const control=button('候補に戻す',()=>{void update(key,null);});control.disabled=busy;
        const cardName=source.assets.cardPreferences?.[item.cardId]?.name??item.cardId;
        list.append(card(item.label,`${cardName} · ${item.frequency==='monthly'?'毎月':'毎年'}`,yen(item.amount),
          filter==='registered'?'カード払い':'候補から除外しています',[control]));
      }
      if(!selected.length)list.append(el('p','subscriptions-empty','登録はありません。'));
    }
    root!.append(list);
    const bottom=el('div','subscriptions-footer');
    bottom.append(el('p','subscriptions-muted','カード払いは明細に含まれます。'));
    bottom.append(button('銀行の定期入出金を管理',deps.openAccountSettings));
    root!.append(bottom);
  }
  return {render,reset,isBusy:()=>busy};
}
