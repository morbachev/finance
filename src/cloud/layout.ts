/** Shared OneDrive application namespace. Payroll will use `payroll/` with the same Entra app ID. */
export const FINANCE_DIR = 'finance';
export const PAYROLL_DIR = 'payroll';
export type YearBucket = string;

/** A correction with no verified billing month must still have a durable, retrievable home. */
export function statementBucket(billingMonth: string | null | undefined): YearBucket {
  if (billingMonth && /^(19|20|21)\d\d-(0[1-9]|1[0-2])$/.test(billingMonth)) return billingMonth.slice(0, 4);
  return 'undated';
}
export function checkBucket(value: string): YearBucket {
  if (!/^(19|20|21)\d\d$|^undated$/.test(value)) throw new Error('保存年度が不正です。');
  return value;
}
export function originalParts(billingMonth: string | null | undefined): [string, string] {
  const bucket = statementBucket(billingMonth);
  return [bucket, bucket === 'undated' ? '00' : billingMonth!.slice(5, 7)];
}
export function checkOriginalMonth(month: string): void {
  if (!/^(0[1-9]|1[0-2]|00)$/.test(month)) throw new Error('PDF保存月が不正です。');
}

export interface FinanceIndex {
  format: 'finance-cloud-index-v1';
  years: YearBucket[];
}
export function emptyIndex(): FinanceIndex { return {format:'finance-cloud-index-v1',years:[]}; }
export function validateIndex(raw:unknown): FinanceIndex {
  if (!raw || typeof raw !== 'object') throw new Error('クラウド索引が不正です。');
  const obj=raw as FinanceIndex;
  if (obj.format !== 'finance-cloud-index-v1' || !Array.isArray(obj.years) || obj.years.length>301) throw new Error('クラウド索引の形式が不正です。');
  const years=new Set<string>();
  for(const year of obj.years) {if(typeof year!=='string')throw new Error('年度情報が不正です。');checkBucket(year);if(years.has(year))throw new Error('年度が重複しています。');years.add(year);}
  return {format:obj.format,years:obj.years};
}
