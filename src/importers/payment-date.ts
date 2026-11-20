/** A card's contractual payment day. Billing month is the Vpass CSV filename's YYYYMM. */
export interface CardPaymentTiming { monthOffset: 0 | 1; day: number }

function dateOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function nthMonday(y: number, m: number, nth: number): number {
  const weekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + (8 - weekday) % 7 + 7 * (nth - 1);
}
function equinox(y: number, autumn: boolean): number {
  return Math.floor((autumn ? 23.2488 : 20.8431) + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}
/** Japan's recurring national holidays, substitutes and citizens' holidays (modern 2024-2099 rules).
 * Calendar exceptions announced in the future will require an application update. */
export function japaneseBankHoliday(day: string): boolean {
  const m = /^(20\d\d)-(\d\d)-(\d\d)$/.exec(day);
  if (!m) throw new Error('引落日の形式が不正です。');
  const y = Number(m[1]), mon = Number(m[2]), d = Number(m[3]);
  if (y < 2024 || y > 2099) throw new Error('自動引落日計算は2024〜2099年に対応しています。');
  const dt = new Date(`${day}T00:00:00Z`);
  if (dt.toISOString().slice(0, 10) !== day) throw new Error('引落日が不正です。');
  if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6 || (mon === 1 && d <= 3) || (mon === 12 && d === 31)) return true;
  const holidays = new Set<string>();
  const add = (month: number, dayOfMonth: number) => holidays.add(dateOf(y, month, dayOfMonth));
  for (const [month, dom] of [[1,1],[2,11],[2,23],[4,29],[5,3],[5,4],[5,5],[8,11],[11,3],[11,23]] as const) add(month,dom);
  add(1,nthMonday(y,1,2));add(7,nthMonday(y,7,3));add(9,nthMonday(y,9,3));add(10,nthMonday(y,10,2));
  add(3,equinox(y,false));add(9,equinox(y,true));
  // Citizens' holidays: a non-holiday sandwiched between two national holidays.
  for(let i=1;i<365;i++){
    const current=new Date(Date.UTC(y,0,i+1));
    if(current.getUTCFullYear()!==y)break;
    const key=current.toISOString().slice(0,10);
    if(holidays.has(key))continue;
    const previous=new Date(current.valueOf()-86400000).toISOString().slice(0,10);
    const next=new Date(current.valueOf()+86400000).toISOString().slice(0,10);
    if(holidays.has(previous)&&holidays.has(next))holidays.add(key);
  }
  // A Sunday national holiday is observed on the next non-holiday weekday.
  for(const holiday of [...holidays]){
    const holidayDate = new Date(`${holiday}T00:00:00Z`);
    if(holidayDate.getUTCDay() !== 0)continue;
    let substitute = new Date(holidayDate.valueOf() + 86400000);
    while(holidays.has(substitute.toISOString().slice(0,10)))substitute = new Date(substitute.valueOf() + 86400000);
    holidays.add(substitute.toISOString().slice(0,10));
  }
  return holidays.has(day);
}

export function cardPaymentDate(billingMonth:string, timing:CardPaymentTiming):string {
  if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(billingMonth) || ![0,1].includes(timing.monthOffset) ||
    !Number.isInteger(timing.day) || timing.day < 1 || timing.day > 31)
    throw new Error('カードの引落設定が不正です。');
  const [year,month]=billingMonth.split('-').map(Number);
  const first=new Date(Date.UTC(year!,month!-1+timing.monthOffset,1));
  const y=first.getUTCFullYear(), m=first.getUTCMonth()+1;
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();
  let current=new Date(Date.UTC(y,m-1,Math.min(timing.day,last)));
  for(let i=0;i<12;i++){
    const day=current.toISOString().slice(0,10);
    if(!japaneseBankHoliday(day))return day;
    current=new Date(current.valueOf()+86400000);
  }
  throw new Error('引落日の翌営業日を算出できませんでした。');
}
