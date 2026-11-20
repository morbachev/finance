/** A single period navigator shared by reports and analytics. No persistent state. */
import {changePeriod} from '../summary/monthly-summary.js';
const valid=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export function monthNavigator(period:string,onChoose:(value:string)=>void,options:{label:string;max?:string;min?:string;today?:string}):HTMLElement{
  const root=document.createElement('div');root.className='finance-period-nav';root.setAttribute('role','group');root.setAttribute('aria-label',options.label);
  const create=(text:string,aria:string,act:()=>void)=>{const button=document.createElement('button');button.type='button';button.textContent=text;button.setAttribute('aria-label',aria);button.addEventListener('click',act);return button;};
  const picker=document.createElement('input');picker.type='month';picker.className='finance-period-input';picker.value=period;picker.min=options.min??'1900-01';picker.max=options.max??'2199-12';picker.setAttribute('aria-label',options.label);
  picker.addEventListener('change',()=>{if(valid(picker.value)&&picker.value>=picker.min&&picker.value<=picker.max)onChoose(picker.value);else picker.value=period;});
  const previous=create('‹','前月',()=>onChoose(changePeriod(period,-1)));
  const next=create('›','翌月',()=>onChoose(changePeriod(period,1)));
  previous.disabled=period<=picker.min;next.disabled=period>=picker.max;
  root.append(previous,picker,next);
  if(options.today){const current=create('今月','今月に戻る',()=>onChoose(options.today!));root.append(current);}
  return root;
}
export function yearNavigator(year:number,onChoose:(year:number)=>void,options:{min:number;max:number}):HTMLElement {
  const root=document.createElement('div');root.className='finance-period-nav';root.setAttribute('role','group');root.setAttribute('aria-label','分析対象年');
  const previous=document.createElement('button');previous.type='button';previous.textContent='‹';previous.setAttribute('aria-label','前年');previous.disabled=year<=options.min;previous.addEventListener('click',()=>onChoose(year-1));
  const picker=document.createElement('select');picker.className='finance-period-input';picker.setAttribute('aria-label','分析対象年');
  for(let y=options.max;y>=options.min;y--){const option=new Option(`${y}年`,String(y));picker.add(option);}picker.value=String(year);
  picker.addEventListener('change',()=>onChoose(Number(picker.value)));
  const next=document.createElement('button');next.type='button';next.textContent='›';next.setAttribute('aria-label','翌年');next.disabled=year>=options.max;next.addEventListener('click',()=>onChoose(year+1));
  const current=document.createElement('button');current.type='button';current.textContent='今年';current.setAttribute('aria-label','今年に戻る');current.addEventListener('click',()=>onChoose(options.max));
  root.append(previous,picker,next,current);return root;
}
