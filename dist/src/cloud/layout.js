/** Shared OneDrive application namespace. Payroll will use `payroll/` with the same Entra app ID. */
export const FINANCE_DIR = 'finance';
export const PAYROLL_DIR = 'payroll';
/** A correction with no verified billing month must still have a durable, retrievable home. */
export function statementBucket(billingMonth) {
    if (billingMonth && /^(19|20|21)\d\d-(0[1-9]|1[0-2])$/.test(billingMonth))
        return billingMonth.slice(0, 4);
    return 'undated';
}
export function checkBucket(value) {
    if (!/^(19|20|21)\d\d$|^undated$/.test(value))
        throw new Error('保存年度が不正です。');
    return value;
}
export function originalParts(billingMonth) {
    const bucket = statementBucket(billingMonth);
    return [bucket, bucket === 'undated' ? '00' : billingMonth.slice(5, 7)];
}
export function checkOriginalMonth(month) {
    if (!/^(0[1-9]|1[0-2]|00)$/.test(month))
        throw new Error('PDF保存月が不正です。');
}
export function emptyIndex() { return { format: 'finance-cloud-index-v1', years: [] }; }
export function validateIndex(raw) {
    if (!raw || typeof raw !== 'object')
        throw new Error('クラウド索引が不正です。');
    const obj = raw;
    if (obj.format !== 'finance-cloud-index-v1' || !Array.isArray(obj.years) || obj.years.length > 301)
        throw new Error('クラウド索引の形式が不正です。');
    const years = new Set();
    for (const year of obj.years) {
        if (typeof year !== 'string')
            throw new Error('年度情報が不正です。');
        checkBucket(year);
        if (years.has(year))
            throw new Error('年度が重複しています。');
        years.add(year);
    }
    return { format: obj.format, years: obj.years };
}
