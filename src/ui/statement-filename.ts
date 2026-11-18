import {getCard,type ParsedStatement} from '../models/types.js';
/** Display/download name only. Stored ciphertext remains UUID.enc for privacy. */
export function canonicalStatementFilename(statement:ParsedStatement,_recordId?:string|null):string { /* finance-v148 */
  const period=/^\d{4}-(0[1-9]|1[0-2])$/.test(statement.billingMonth??'')
    ? statement.billingMonth! : /^\d{4}-\d{2}-\d{2}$/.test(statement.paymentDate??'')
      ? statement.paymentDate!.slice(0,7):'年月不明';
  const name=getCard(statement.cardId)?.name ?? 'カード種別未設定';
  const safe=name.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'_').replace(/\s+/g,' ').trim().slice(0,60);
  return `${period.replace(/-/g,'')}_${safe}_明細.pdf`;
}
