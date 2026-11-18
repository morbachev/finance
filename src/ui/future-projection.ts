/** The long-term savings planner is entirely read-only. Editable fields are
 * ephemeral simulation assumptions; only an explicitly saved birth month is persisted. */
import type { AssetsDocument } from '../cloud/assets.js';
import type { CloudRecord } from '../cloud/merge.js';
import {futureProjection, suggestedNisaMonthly, targetMonthForAge, type FuturePoint} from '../cloud/future-projection.js';

export interface FutureProjectionUi {render():void;reset():void}
export interface FutureSource {assets:AssetsDocument;records:CloudRecord[]}
const yen=(n:number|null)=>n===null?'未登録':`${Math.round(n).toLocaleString('ja-JP')}円`;
const short=(n:number|null)=>n===null?'--':Math.abs(n)>=10000?`${(n/10000).toLocaleString('ja-JP',{maximumFractionDigits:1})}万円`:`${Math.round(n).toLocaleString('ja-JP')}円`;
function el(tag:string,className='',text?:string):HTMLElement{
  const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;
}
function localToday():string {
  const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function incrementYearMonth(month:string,years:number):string{
  return `${Number(month.slice(0,4))+years}-${month.slice(5)}`;
}
function monthAfter(month:string):string{
  const y=Number(month.slice(0,4)),m=Number(month.slice(5));
  return `${y+(m===12?1:0)}-${String(m===12?1:m+1).padStart(2,'0')}`;
}
function dateTitle(month:string):string{return `${month.slice(0,4)}年${Number(month.slice(5))}月`;}
const svgNS='http://www.w3.org/2000/svg';
function svgNode(tag:string,attrs:Record<string,string>):SVGElement{
  const node=document.createElementNS(svgNS,tag);
  for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);
  return node;
}
function ageText(month:string,born:string):string {
  if(!born)return '';
  const age=Number(month.slice(0,4))-Number(born.slice(0,4))-(Number(month.slice(5))<Number(born.slice(5))?1:0);
  return age>=0?`（${age}歳）`:'';
}
function drawChart(container:HTMLElement,points:FuturePoint[],born:string,compare:boolean):void{
  container.replaceChildren();
  const names:[keyof FuturePoint,string,string][]=[
    ['cash','現金貯金','cash'],
    ['nisa','NISA','nisa'],
    ['combined','現金＋NISA','base'],
    ...(compare?[['combinedScenario','積立変更後の合計','scenario'] as [keyof FuturePoint,string,string]]:[]),
  ];
  const values=points.flatMap(p=>names.flatMap(([key])=>typeof p[key]==='number'?[p[key] as number]:[]));
  if(values.length<2){container.append(el('p','future-help','残高を登録すると推移グラフを表示します。'));return;}
  const min=Math.min(0,...values),max=Math.max(1,...values),range=max-min;
  const w=840,h=270,padX=50,padTop=18,padBottom=38;
  const x=(i:number)=>padX+(i/(points.length-1||1))*(w-padX-16);
  const y=(value:number)=>padTop+(max-value)/range*(h-padTop-padBottom);
  const svg=svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':'現金貯金・NISA・合計の将来推移',class:'future-chart-svg'});
  for(let i=0;i<=4;i++){
    const value=min+range*i/4;
    const yy=y(value);
    svg.append(svgNode('line',{x1:String(padX),x2:String(w-16),y1:String(yy),y2:String(yy),class:'future-gridline'}));
    const label=svgNode('text',{x:String(padX-8),y:String(yy+4),'text-anchor':'end',class:'future-axis-text'});
    label.textContent=Math.round(value/10000).toLocaleString('ja-JP')+'万';svg.append(label);
  }
  for(const [key,,cls] of names){
    const finite=points.map((p,i)=>({i,value:p[key]})).filter((p):p is {i:number;value:number}=>typeof p.value==='number');
    if(finite.length<2)continue;
    const path=finite.map(p=>`${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    svg.append(svgNode('polyline',{points:path,fill:'none',class:`future-path future-path-${cls}`,'stroke-linecap':'round','stroke-linejoin':'round'}));
  }
  const tickIndices=[0,Math.floor((points.length-1)/2),points.length-1];
  for(const i of [...new Set(tickIndices)]){
    const label=svgNode('text',{x:String(x(i)),y:String(h-12),'text-anchor':i===0?'start':i===points.length-1?'end':'middle',class:'future-axis-text'});
    label.textContent=points[i]!.month.slice(0,4)+'年'+ageText(points[i]!.month,born);svg.append(label);
  }
  container.append(svg);
  const legend=el('div','future-legend');
  for(const [,name,cls] of names)legend.append(el('span',`future-legend-item future-legend-${cls}`,name));
  container.append(legend);
}

export function initFutureProjection(getSource:()=>FutureSource|null,saveBirthMonth:(birthMonth:string|null)=>Promise<void>):FutureProjectionUi {
  const find=<T extends HTMLElement>(id:string)=>{
    const n=document.getElementById(id);if(!n)throw Error(`Future UI missing: ${id}`);return n as T;
  };
  const target=find<HTMLInputElement>('future-target');
  const born=find<HTMLInputElement>('future-born');
  const age=find<HTMLInputElement>('future-age');
  const from=find<HTMLInputElement>('future-change-month');
  const saving=find<HTMLInputElement>('future-saving-amount');
  const nisaScenarioInput=find<HTMLInputElement>('future-scenario-nisa');
  const nisaMonthly=find<HTMLInputElement>('future-nisa-monthly');
  const nisaRate=find<HTMLInputElement>('future-nisa-rate');
  const results=find<HTMLElement>('future-results');
  const scenarioPanel=find<HTMLElement>('future-scenario-settings');
  const scenarioAccordion=find<HTMLDetailsElement>('future-scenario-accordion');
  const cashChoice=find<HTMLInputElement>('future-compare-cash');
  const nisaChoice=find<HTMLInputElement>('future-compare-nisa');
  let compare=false;
  const updateScenarioControls=()=>{
    const cash=cashChoice.checked, nisa=nisaChoice.checked;
    find<HTMLElement>('future-cash-amount-wrap').hidden=!cash;
    find<HTMLElement>('future-nisa-amount-wrap').hidden=!nisa;
    saving.disabled=!cash;
    nisaScenarioInput.disabled=!nisa;
  };
  for(const choice of [cashChoice,nisaChoice])choice.addEventListener('change',()=>{
    // The closed accordion is the "no changes" state. Keep one or both active while open.
    if(!cashChoice.checked&&!nisaChoice.checked)choice.checked=true;
    updateScenarioControls();render();
  });
  const syncScenarioAccordion=()=>{
    compare=scenarioAccordion.open;
    scenarioPanel.hidden=!compare;
    updateScenarioControls();
    render();
  };
  scenarioAccordion.addEventListener('toggle',syncScenarioAccordion);
  scenarioPanel.hidden=!scenarioAccordion.open;
  compare=scenarioAccordion.open;
  updateScenarioControls();
  const hint=find<HTMLElement>('future-hint');
  const today=localToday();
  target.value=incrementYearMonth(today.slice(0,7),18);
  from.value=monthAfter(today.slice(0,7));from.min=from.value;
  saving.value='20000';nisaScenarioInput.value='20000';nisaRate.value='3';
  let defaultNisaMonthly=0;
  let nisaEdited=false;
  let scenarioCashEdited=false;
  let scenarioNisaEdited=false;
  let bornEdited=false;
  let bornSaving=false;
  const moneyField=(input:HTMLInputElement)=>input.value.trim()&&Number.isSafeInteger(Number(input.value))&&Number(input.value)>=0?Number(input.value):null;
  const monthlyEquivalent=(entries:FutureSource['assets']['recurring']):number=>
    Math.round(entries.reduce((sum,e)=>sum+(e.frequency==='monthly'?e.amount:e.frequency==='weekly'?e.amount*52/12:e.amount/12),0));
  const updateAgeTarget=()=>{
    const calculated=targetMonthForAge(born.value,Number(age.value));
    if(calculated)target.value=calculated;
    render();
  };
  age.addEventListener('input',updateAgeTarget);
  born.addEventListener('input',()=>{bornEdited=true;updateAgeTarget();});
  nisaRate.addEventListener('input',render);
  from.addEventListener('input',render);
  saving.addEventListener('input',()=>{scenarioCashEdited=true;render();});
  nisaScenarioInput.addEventListener('input',()=>{scenarioNisaEdited=true;render();});
  nisaMonthly.addEventListener('input',()=>{nisaEdited=true;render();});
  find<HTMLButtonElement>('future-born-save').addEventListener('click',()=>{
    if(bornSaving)return;
    const val=born.value;
    if(!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(val)||val>localToday().slice(0,7)){
      find('future-born-status').textContent='生年月を確認してください。';return;
    }
    bornSaving=true;const button=find<HTMLButtonElement>('future-born-save');button.disabled=true;
    find('future-born-status').textContent='保存中…';
    void saveBirthMonth(val).then(()=>{
      bornEdited=false;find('future-born-status').textContent='保存しました。';render();
    }).catch(err=>{find('future-born-status').textContent=`保存失敗：${err instanceof Error?err.message:'通信エラー'}`;}).finally(()=>{
      bornSaving=false;button.disabled=false;
    });
  });
  function makeMetric(title:string,value:number|null,style:'cash'|'nisa'|'base'|'scenario',sub?:string):HTMLElement {
    const card=el('div',`future-metric future-metric-${style}`);
    const label=el('div','future-metric-label');
    label.append(el('span',`future-color-key future-color-key-${style}`),el('span','',title));
    card.append(label,el('strong','',short(value)));
    if(sub)card.append(el('small','future-muted',sub));
    return card;
  }
  function render():void {
    const source=getSource();
    results.replaceChildren();
    if(!source){hint.textContent='OneDrive保管庫の解除後に将来資産を試算できます。';return;}
    if(!bornEdited && source.assets.birthMonth && born.value!==source.assets.birthMonth){
      born.value=source.assets.birthMonth;
      const endMonth=targetMonthForAge(born.value,Number(age.value));if(endMonth)target.value=endMonth;
    }
    find('future-age-value').textContent=`${age.value}歳`;
    find('future-nisa-rate-value').textContent=`${Number(nisaRate.value).toFixed(1)}%`;
    find('future-target-label').textContent=born.value?`${dateTitle(target.value)}（${age.value}歳）`:'生年月を入力すると年齢で予測できます';
    const cashRules=source.assets.recurring.filter(e=>e.enabled&&e.toAccountId==='cash-savings'&&e.fromAccountId!=='cash-savings'&&(e.kind==='transfer'||e.kind==='income'));
    const nisaRules=source.assets.recurring.filter(e=>e.enabled&&e.toAccountId==='nisa'&&(e.kind==='income'||e.kind==='transfer'));
    const hasNisaSchedule=nisaRules.length>0;
    const suggested=suggestedNisaMonthly(source.assets,source.records,localToday());
    if(hasNisaSchedule){nisaMonthly.value='0';nisaMonthly.disabled=true;defaultNisaMonthly=0;}
    else {
      nisaMonthly.disabled=false;
      if(!nisaEdited){nisaMonthly.value=String(suggested.amount);defaultNisaMonthly=suggested.amount;}
    }
    const cashMonthly=monthlyEquivalent(cashRules);
    const nisaBase=hasNisaSchedule?monthlyEquivalent(nisaRules):Number(nisaMonthly.value)||0;
    if(!scenarioCashEdited)saving.value=String(Math.ceil((cashMonthly+5000)/5000)*5000);
    if(!scenarioNisaEdited)nisaScenarioInput.value=String(Math.ceil((nisaBase+5000)/5000)*5000);
    find('future-scenario-hint').textContent=`現在の月額目安：現金 ${yen(cashMonthly)} · NISA ${yen(nisaBase)}`;
    const todayValue=localToday();
    const todayPeriod=todayValue.slice(0,7);
    const amount=moneyField(saving),scenarioNisaAmount=moneyField(nisaScenarioInput),nisaAmount=moneyField(nisaMonthly);
    const changesCash=compare&&cashChoice.checked;
    const changesNisa=compare&&nisaChoice.checked;
    if(!target.value||target.value<todayPeriod||!from.value||from.value<todayPeriod||
       !Number.isFinite(Number(nisaRate.value))||nisaAmount===null||
       (changesCash&&amount===null)||(changesNisa&&scenarioNisaAmount===null)){
      hint.textContent='年月と積立額を確認してください。';return;
    }
    try {
      const report=futureProjection(source.assets,source.records,{
        today:todayValue,targetMonth:target.value,changeMonth:from.value,savingsRuleId:null,
        savingsAmount:amount??0,nisaMonthly:hasNisaSchedule?0:nisaAmount,nisaAnnualReturn:Number(nisaRate.value)/100,
        cashScenarioMonthly:changesCash?amount:null,
        nisaScenarioMonthly:changesNisa?scenarioNisaAmount:null,
      });
      hint.textContent='';
      const totals=el('div',`future-totals${compare?' is-comparing':''}`);
      totals.append(makeMetric('合計',report.target.combined,'base',compare?'現在の積立ペース':''));
      if(compare)totals.append(makeMetric('変更後の合計',report.target.combinedScenario,'scenario',`${dateTitle(from.value)}から`));
      results.append(totals);
      const breakdown=el('div','future-breakdown');
      breakdown.append(makeMetric('現金貯金',report.target.cash,'cash',changesCash?`変更後 ${short(report.target.cashScenario)}`:undefined));
      breakdown.append(makeMetric('NISA',report.target.nisa,'nisa',changesNisa?`変更後 ${short(report.target.nisaScenario)}`:undefined));
      results.append(breakdown);
      if(report.conflictingNisaSources)results.append(el('p','future-warning','NISAの積立設定が重複している可能性があります。'));
      if(report.cashStart===null||report.nisaStart===null)results.append(el('p','future-warning','口座管理で現在の残高を登録してください。'));
      const graph=el('div','future-chart');drawChart(graph,report.points,born.value,compare);results.append(graph);
      const tableWrap=el('div','future-table-scroll');const table=document.createElement('table');table.className='future-table';
      const thead=document.createElement('thead');const tr=document.createElement('tr');
      const columns=compare?['年月','現金貯金','NISA','合計','変更後の合計']:['年月','現金貯金','NISA','合計'];
      for(const label of columns)tr.append(el('th','',label));
      thead.append(tr);table.append(thead);
      const tbody=document.createElement('tbody');
      const selected=report.points.filter((p,i)=>i===0||i===report.points.length-1||p.month.endsWith('-12'));
      for(const point of selected){const row=document.createElement('tr');
        const vals=compare?[dateTitle(point.month)+ageText(point.month,born.value),yen(point.cash),yen(point.nisa),yen(point.combined),yen(point.combinedScenario)]
          :[dateTitle(point.month)+ageText(point.month,born.value),yen(point.cash),yen(point.nisa),yen(point.combined)];
        for(const value of vals)row.append(el('td','',value));tbody.append(row);
      }
      table.append(tbody);tableWrap.append(table);results.append(tableWrap);
    }catch(error){hint.textContent=error instanceof Error?error.message:'将来予測を計算できませんでした。';}
  }
  const reset=()=>{
    born.value='';bornEdited=false;target.value=incrementYearMonth(localToday().slice(0,7),18);
    from.value=monthAfter(localToday().slice(0,7));saving.value='20000';nisaScenarioInput.value='20000';
    scenarioCashEdited=false;scenarioNisaEdited=false;nisaEdited=false;nisaMonthly.value='';results.replaceChildren();hint.textContent='保管庫を解除してください.';
    compare=false;scenarioAccordion.open=false;scenarioPanel.hidden=true;
    cashChoice.checked=true;nisaChoice.checked=false;updateScenarioControls();
  };
  return {render,reset};
}
