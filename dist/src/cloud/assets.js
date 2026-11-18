import { CARDS } from '../models/types.js';
/** Finance assets settings are independent from statements and merchant rules.
 * Snapshots are confirmed balances, not reconstructed transactions. */
export const ASSET_ACCOUNTS = [
    { id: 'rakuten-bank', name: '楽天銀行', detail: '生活費・カード引落など', icon: '🏦' },
    { id: 'mizuho-bank', name: 'みずほ銀行', detail: 'みずほ楽天カードの引落', icon: '🏛️' },
    { id: 'cash-savings', name: '現金貯金専用口座', detail: '楽天銀行から定期送金', icon: '🐖' },
    { id: 'nisa', name: 'NISA口座', detail: '積立投資の評価額', icon: '🌱' },
];
export function oneTimeAccountDelta(entry, accountId) {
    return (entry.toAccountId === accountId ? entry.amount : 0) - (entry.fromAccountId === accountId ? entry.amount : 0);
}
/** A dated manual entry can confirm or replace an otherwise duplicate schedule. */
export function recurringCoveredByOneTime(occurrence, day, entries = []) {
    const name = occurrence.name.normalize('NFKC').trim().toLocaleLowerCase();
    return entries.some(entry => entry.date === day && entry.kind === occurrence.kind &&
        entry.amount === occurrence.amount && entry.fromAccountId === occurrence.fromAccountId &&
        entry.toAccountId === occurrence.toAccountId && entry.name.normalize('NFKC').trim().toLocaleLowerCase() === name);
}
export const DEFAULT_MIZUHO_PLAN = { enabled: false, leadDays: 3, extraForSmallBills: true };
export function validateMizuhoPlan(value) {
    if (value === undefined || value === null)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('みずほ送金予測の設定が不正です。');
    const v = value;
    if (typeof v.enabled !== 'boolean' || !Number.isSafeInteger(v.leadDays) || v.leadDays < 0 || v.leadDays > 20 || typeof v.extraForSmallBills !== 'boolean')
        throw new Error('みずほ送金予測の設定が不正です。');
    return { enabled: v.enabled, leadDays: v.leadDays, extraForSmallBills: v.extraForSmallBills };
}
export function emptyAssets() {
    return { format: 'finance-assets-v1', snapshots: [], recurring: [], deletedSnapshots: [], deletedRecurring: [], conflicts: [], nisaCardRule: null, payrollDepositAccount: null, payrollAutoPassphrase: null };
}
const accountIds = new Set(ASSET_ACCOUNTS.map(a => a.id));
const idPattern = /^[a-zA-Z0-9-]{6,80}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const clone = (value) => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function validateDate(value) {
    if (typeof value !== 'string' || !datePattern.test(value))
        return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function checkAccount(value) { return typeof value === 'string' && accountIds.has(value); }
export function validateSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !idPattern.test(raw.id) ||
        !checkAccount(raw.accountId) || !Number.isSafeInteger(raw.balance) || raw.balance < 0 ||
        typeof raw.observedAt !== 'string' || raw.observedAt.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T/.test(raw.observedAt) ||
        !Number.isFinite(Date.parse(raw.observedAt)) || !/(Z|[+-]\d{2}:\d{2})$/.test(raw.observedAt))
        throw new Error('口座残高の記録が不正です。金額と確認日時を確認してください。');
    return { id: raw.id, accountId: raw.accountId, balance: raw.balance, observedAt: new Date(raw.observedAt).toISOString() };
}
export function validateOneTime(raw) {
    if (!raw || typeof raw !== 'object' || (typeof raw.id !== 'string' || !idPattern.test(raw.id)) || !validateDate(raw.date) ||
        typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 80 ||
        !Number.isSafeInteger(raw.amount) || raw.amount <= 0 ||
        !['expense', 'income', 'transfer', 'withdrawal'].includes(raw.kind) ||
        !['done', 'planned'].includes(raw.status) ||
        (raw.fromAccountId !== null && !checkAccount(raw.fromAccountId)) ||
        (raw.toAccountId !== null && !checkAccount(raw.toAccountId)))
        throw new Error('単発の入出金を確認してください。');
    if (raw.kind === 'income' && (!checkAccount(raw.toAccountId) || raw.fromAccountId !== null))
        throw new Error('入金先口座を指定してください。');
    if ((raw.kind === 'expense' || raw.kind === 'withdrawal') && (!checkAccount(raw.fromAccountId) || raw.toAccountId !== null))
        throw new Error('出金元口座を指定してください。');
    if (raw.kind === 'transfer' && (!checkAccount(raw.fromAccountId) || !checkAccount(raw.toAccountId) || raw.fromAccountId === raw.toAccountId))
        throw new Error('振替元と振替先を別々に指定してください。');
    if (raw.cardFunding !== undefined && typeof raw.cardFunding !== 'boolean')
        throw new Error('カード送金の区別が不正です。');
    if (raw.cardFunding && !(raw.kind === 'transfer' && raw.fromAccountId === 'rakuten-bank' && raw.toAccountId === 'mizuho-bank'))
        throw new Error('カード代金送金は楽天銀行からみずほ銀行への振替だけ指定できます。');
    return { ...raw, name: raw.name.trim() };
}
export function validateRecurring(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !idPattern.test(raw.id) ||
        typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 80 ||
        !Number.isSafeInteger(raw.amount) || raw.amount <= 0 ||
        !['expense', 'income', 'transfer'].includes(raw.kind) ||
        (raw.fromAccountId !== null && !checkAccount(raw.fromAccountId)) ||
        (raw.toAccountId !== null && !checkAccount(raw.toAccountId)) ||
        !['monthly', 'yearly', 'weekly'].includes(raw.frequency) ||
        !validateDate(raw.startOn) || (raw.endOn !== null && !validateDate(raw.endOn)) ||
        (raw.endOn !== null && raw.endOn < raw.startOn) ||
        (raw.categoryId !== null && (typeof raw.categoryId !== 'string' || raw.categoryId.length > 90 || !/^[a-z0-9-]+$/.test(raw.categoryId))) ||
        typeof raw.enabled !== 'boolean')
        throw new Error('定期入出金の登録内容が不正です。');
    if (raw.kind === 'expense' && (!checkAccount(raw.fromAccountId) || raw.toAccountId !== null))
        throw new Error('支出の引落元口座を指定してください。');
    if (raw.kind === 'income' && (!checkAccount(raw.toAccountId) || raw.fromAccountId !== null))
        throw new Error('収入の入金先口座を指定してください。');
    if (raw.kind === 'transfer' && (!checkAccount(raw.fromAccountId) || !checkAccount(raw.toAccountId) || raw.fromAccountId === raw.toAccountId))
        throw new Error('振替元と振替先は別の口座を指定してください。');
    if (raw.frequency === 'weekly') {
        if (!Number.isInteger(raw.weekday) || raw.weekday === null || raw.weekday < 0 || raw.weekday > 6 || raw.dayOfMonth !== null || raw.monthOfYear !== null)
            throw new Error('毎週の曜日設定が不正です。');
    }
    else {
        if (!Number.isInteger(raw.dayOfMonth) || raw.dayOfMonth === null || raw.dayOfMonth < 0 || raw.dayOfMonth > 31 || raw.weekday !== null ||
            (raw.frequency === 'monthly' ? raw.monthOfYear !== null : !Number.isInteger(raw.monthOfYear) || raw.monthOfYear === null || raw.monthOfYear < 1 || raw.monthOfYear > 12))
            throw new Error('定期入出金の日付設定が不正です。');
    }
    return { ...raw, name: raw.name.trim() };
}
export function validateNisaCardRule(raw) {
    if (raw == null)
        return null; // Existing finance-assets-v1 documents remain readable.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('NISAのカード積立連携設定が不正です。');
    const rule = raw;
    if (typeof rule.cardId !== 'string' || !rule.cardId || rule.cardId.length > 80 ||
        typeof rule.merchantContains !== 'string' || rule.merchantContains.trim().length < 3 || rule.merchantContains.trim().length > 90 ||
        typeof rule.enabled !== 'boolean')
        throw new Error('NISAのカード積立連携設定が不正です。');
    return { cardId: rule.cardId, merchantContains: rule.merchantContains.trim(), enabled: rule.enabled };
}
export function validatePayrollDepositAccount(raw) {
    if (raw === undefined || raw === null)
        return null;
    if (!checkAccount(raw) || raw === 'nisa')
        throw new Error('給与の受取口座の設定が不正です。');
    return raw;
}
/** Preserve the exact secret, including whitespace, for the Payroll PBKDF2 derivation. */
export function validatePayrollAutoPassphrase(raw) {
    if (raw === null || raw === undefined)
        return null;
    if (typeof raw !== 'string' || [...raw].length < 12 || [...raw].length > 1024)
        throw new Error('Payrollの自動連携用パスフレーズの形式が不正です。');
    return raw;
}
export function validateBirthMonth(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string' || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value))
        throw new Error('生年月を確認してください。');
    return value;
}
export function validateCardDebitAccounts(value) {
    if (value === undefined || value === null)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('カード引落口座の設定が不正です。');
    const allowed = new Set(CARDS.map(c => c.id));
    const result = {};
    for (const [id, account] of Object.entries(value)) {
        if (!allowed.has(id) || !checkAccount(account) || account === 'nisa')
            throw new Error('カード引落口座の設定が不正です。');
        result[id] = account;
    }
    return result;
}
export function validateAssets(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('資産設定の暗号データが不正です。');
    const doc = raw;
    if (doc.format !== 'finance-assets-v1' || !Array.isArray(doc.snapshots) || !Array.isArray(doc.recurring) ||
        !Array.isArray(doc.deletedSnapshots) || !Array.isArray(doc.deletedRecurring) || !Array.isArray(doc.conflicts) ||
        doc.snapshots.length > 1000 || doc.recurring.length > 300 || doc.deletedSnapshots.length > 2500 || doc.deletedRecurring.length > 2500 || doc.conflicts.length > 300)
        throw new Error('資産設定の形式または件数が不正です。');
    const snapshots = doc.snapshots.map(validateSnapshot), recurring = doc.recurring.map(validateRecurring);
    if (doc.oneTime !== undefined && (!Array.isArray(doc.oneTime) || doc.oneTime.length > 3000))
        throw new Error('単発の入出金件数が不正です。');
    if (doc.deletedOneTime !== undefined && (!Array.isArray(doc.deletedOneTime) || doc.deletedOneTime.length > 5000))
        throw new Error('単発の削除履歴が不正です。');
    const oneTime = (doc.oneTime ?? []).map(validateOneTime);
    for (const list of [snapshots, recurring, oneTime]) {
        const ids = new Set();
        for (const item of list) {
            if (ids.has(item.id))
                throw new Error('資産設定の識別子が重複しています。');
            ids.add(item.id);
        }
    }
    const checkDeleted = (ids) => {
        if (ids.some(x => typeof x !== 'string' || !idPattern.test(x)))
            throw new Error('削除済み設定の形式が不正です。');
        return [...new Set(ids)];
    };
    const deletedSnapshots = checkDeleted(doc.deletedSnapshots), deletedRecurring = checkDeleted(doc.deletedRecurring);
    const deletedOneTime = checkDeleted(doc.deletedOneTime ?? []);
    if (snapshots.some(s => deletedSnapshots.includes(s.id)) || recurring.some(s => deletedRecurring.includes(s.id)) || oneTime.some(s => deletedOneTime.includes(s.id)))
        throw new Error('削除済み設定と有効な設定が重複しています。');
    if (doc.conflicts.some(c => !c || typeof c.itemId !== 'string' || !idPattern.test(c.itemId) || typeof c.field !== 'string' || c.field.length > 50 || typeof c.at !== 'string' || !Number.isFinite(Date.parse(c.at))))
        throw new Error('資産設定の競合履歴が不正です。');
    return { format: 'finance-assets-v1', snapshots, recurring, deletedSnapshots, deletedRecurring, conflicts: clone(doc.conflicts), nisaCardRule: validateNisaCardRule(doc.nisaCardRule), payrollDepositAccount: validatePayrollDepositAccount(doc.payrollDepositAccount),
        ...(validateMizuhoPlan(doc.mizuhoTransferPlan) ? { mizuhoTransferPlan: validateMizuhoPlan(doc.mizuhoTransferPlan) } : {}),
        payrollAutoPassphrase: validatePayrollAutoPassphrase(doc.payrollAutoPassphrase),
        ...(validateBirthMonth(doc.birthMonth) ? { birthMonth: validateBirthMonth(doc.birthMonth) } : {}),
        ...(doc.cardDebitAccounts !== undefined ? { cardDebitAccounts: validateCardDebitAccounts(doc.cardDebitAccounts) } : {}),
        ...(doc.oneTime !== undefined ? { oneTime } : {}), ...(doc.deletedOneTime !== undefined ? { deletedOneTime } : {}) };
}
export function latestBalance(doc, account, asOf) {
    const found = doc.snapshots.filter(s => s.accountId === account && (!asOf || s.observedAt <= asOf));
    return found.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id))[0] ?? null;
}
/** Finds only same-field changes (and delete-vs-edit collisions). Disjoint edits
 * are safe to merge without interrupting the user. */
export function detectAssetsEditCollisions(base, local, remote) {
    const collisions = [];
    const mark = (itemId, field) => {
        if (!collisions.some(c => c.itemId === itemId && c.field === field))
            collisions.push({ itemId, field });
    };
    const sameEdit = (itemId, field, baseline, left, right) => {
        if (!same(left, baseline) && !same(right, baseline) && !same(left, right))
            mark(itemId, field);
    };
    const collection = (b, l, r, bDeleted, lDeleted, rDeleted, fields) => {
        const bm = new Map(b.map(x => [x.id, x])), lm = new Map(l.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x]));
        for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys(), ...bDeleted, ...lDeleted, ...rDeleted])) {
            const bv = bm.get(id), lv = lm.get(id), rv = rm.get(id);
            if (lDeleted.includes(id) && rv && !same(rv, bv))
                mark(id, 'delete');
            if (rDeleted.includes(id) && lv && !same(lv, bv))
                mark(id, 'delete');
            if (!lv || !rv || lDeleted.includes(id) || rDeleted.includes(id))
                continue;
            for (const field of fields)
                sameEdit(id, String(field), bv?.[field], lv[field], rv[field]);
        }
    };
    collection(base.snapshots, local.snapshots, remote.snapshots, base.deletedSnapshots, local.deletedSnapshots, remote.deletedSnapshots, ['accountId', 'balance', 'observedAt']);
    collection(base.recurring, local.recurring, remote.recurring, base.deletedRecurring, local.deletedRecurring, remote.deletedRecurring, ['name', 'amount', 'kind', 'fromAccountId', 'toAccountId', 'frequency', 'dayOfMonth', 'monthOfYear', 'weekday', 'startOn', 'endOn', 'categoryId', 'enabled']);
    collection(base.oneTime ?? [], local.oneTime ?? [], remote.oneTime ?? [], base.deletedOneTime ?? [], local.deletedOneTime ?? [], remote.deletedOneTime ?? [], ['date', 'name', 'amount', 'kind', 'status', 'fromAccountId', 'toAccountId', 'cardFunding']);
    sameEdit('nisa-card-rule', 'nisaCardRule', base.nisaCardRule ?? null, local.nisaCardRule ?? null, remote.nisaCardRule ?? null);
    sameEdit('payroll-deposit-account', 'payrollDepositAccount', base.payrollDepositAccount ?? null, local.payrollDepositAccount ?? null, remote.payrollDepositAccount ?? null);
    sameEdit('payroll-auto-credential', 'payrollAutoPassphrase', base.payrollAutoPassphrase ?? null, local.payrollAutoPassphrase ?? null, remote.payrollAutoPassphrase ?? null);
    sameEdit('birth-month', 'birthMonth', base.birthMonth, local.birthMonth, remote.birthMonth);
    for (const id of new Set([...Object.keys(base.cardDebitAccounts ?? {}), ...Object.keys(local.cardDebitAccounts ?? {}), ...Object.keys(remote.cardDebitAccounts ?? {})]))
        sameEdit('card-debit-accounts', id, base.cardDebitAccounts?.[id], local.cardDebitAccounts?.[id], remote.cardDebitAccounts?.[id]);
    sameEdit('mizuho-transfer-plan', 'mizuhoTransferPlan', base.mizuhoTransferPlan, local.mizuhoTransferPlan, remote.mizuhoTransferPlan);
    return collisions;
}
/** Merge independent additions, removals and field edits from two devices. Concurrent
 * same-field edits prefer the saving device ONLY after explicit user approval in LiveVault.
 * This pure function retains old merge behavior for compatibility with existing audit data. */
export function mergeAssets(base, local, remote, now = new Date().toISOString(), preferLocalDeletes = false) {
    const conflicts = [...remote.conflicts];
    for (const c of local.conflicts)
        if (!conflicts.some(x => same(x, c)))
            conflicts.push(clone(c));
    const mergeGroup = (b, l, r, bDeleted, lDeleted, rDeleted, fields) => {
        const bm = new Map(b.map(x => [x.id, x])), lm = new Map(l.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x]));
        const deleted = new Set([...bDeleted, ...lDeleted, ...rDeleted]);
        const entries = [];
        for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys(), ...deleted])) {
            const bv = bm.get(id), lv = lm.get(id), rv = rm.get(id);
            if (lDeleted.includes(id) && (!rv || same(bv, rv))) {
                deleted.add(id);
                continue;
            }
            if (rDeleted.includes(id) && (!lv || same(bv, lv))) {
                deleted.add(id);
                continue;
            }
            if (lDeleted.includes(id) && rv && !same(rv, bv)) {
                if (preferLocalDeletes) {
                    conflicts.push({ itemId: id, field: 'delete', discarded: clone(rv), chosen: '削除', at: now });
                    deleted.add(id);
                    continue;
                }
                conflicts.push({ itemId: id, field: 'delete', discarded: '削除', chosen: clone(rv), at: now });
                entries.push(clone(rv));
                deleted.delete(id);
                continue;
            }
            if (rDeleted.includes(id) && lv && !same(lv, bv)) {
                conflicts.push({ itemId: id, field: 'delete', discarded: '削除', chosen: clone(lv), at: now });
                entries.push(clone(lv));
                deleted.delete(id);
                continue;
            }
            if (!lv && !rv)
                continue;
            if (!lv && rv) {
                entries.push(clone(rv));
                deleted.delete(id);
                continue;
            }
            if (!rv && lv) {
                entries.push(clone(lv));
                deleted.delete(id);
                continue;
            }
            if (!lv || !rv)
                continue;
            const merged = { id };
            for (const k of fields) {
                if (k === 'id')
                    continue;
                const key = String(k), baseline = bv?.[k], left = lv[k], right = rv[k];
                if (same(left, baseline))
                    merged[key] = clone(right);
                else if (same(right, baseline) || same(left, right))
                    merged[key] = clone(left);
                else {
                    merged[key] = clone(left);
                    conflicts.push({ itemId: id, field: key, discarded: clone(right), chosen: clone(left), at: now });
                }
            }
            entries.push(merged);
            deleted.delete(id);
        }
        return { entries, deleted: [...deleted] };
    };
    const snapshots = mergeGroup(base.snapshots, local.snapshots, remote.snapshots, base.deletedSnapshots, local.deletedSnapshots, remote.deletedSnapshots, ['accountId', 'balance', 'observedAt']);
    const recurring = mergeGroup(base.recurring, local.recurring, remote.recurring, base.deletedRecurring, local.deletedRecurring, remote.deletedRecurring, ['name', 'amount', 'kind', 'fromAccountId', 'toAccountId', 'frequency', 'dayOfMonth', 'monthOfYear', 'weekday', 'startOn', 'endOn', 'categoryId', 'enabled']);
    const oneTimes = mergeGroup(base.oneTime ?? [], local.oneTime ?? [], remote.oneTime ?? [], base.deletedOneTime ?? [], local.deletedOneTime ?? [], remote.deletedOneTime ?? [], ['date', 'name', 'amount', 'kind', 'status', 'fromAccountId', 'toAccountId', 'cardFunding']);
    const baseline = base.nisaCardRule ?? null, left = local.nisaCardRule ?? null, right = remote.nisaCardRule ?? null;
    let nisaCardRule;
    if (same(left, baseline))
        nisaCardRule = clone(right);
    else if (same(right, baseline) || same(left, right))
        nisaCardRule = clone(left);
    else {
        nisaCardRule = clone(left);
        conflicts.push({ itemId: 'nisa-card-rule', field: 'nisaCardRule', discarded: clone(right), chosen: clone(left), at: now });
    }
    const oldAccount = base.payrollDepositAccount ?? null, localAccount = local.payrollDepositAccount ?? null, remoteAccount = remote.payrollDepositAccount ?? null;
    let payrollDepositAccount;
    if (same(localAccount, oldAccount))
        payrollDepositAccount = remoteAccount;
    else if (same(remoteAccount, oldAccount) || same(localAccount, remoteAccount))
        payrollDepositAccount = localAccount;
    else {
        payrollDepositAccount = localAccount;
        conflicts.push({ itemId: 'payroll-deposit-account', field: 'payrollDepositAccount', discarded: remoteAccount, chosen: localAccount, at: now });
    }
    const previousSecret = base.payrollAutoPassphrase ?? null;
    const localSecret = local.payrollAutoPassphrase ?? null;
    const remoteSecret = remote.payrollAutoPassphrase ?? null;
    let payrollAutoPassphrase;
    if (same(localSecret, previousSecret))
        payrollAutoPassphrase = remoteSecret;
    else if (same(remoteSecret, previousSecret) || same(localSecret, remoteSecret))
        payrollAutoPassphrase = localSecret;
    else {
        payrollAutoPassphrase = localSecret;
        // Never put either old or new credential into the permanent conflict log.
        conflicts.push({ itemId: 'payroll-auto-credential', field: 'payrollAutoPassphrase', discarded: '競合', chosen: '保存端末側を優先', at: now });
    }
    const bBirth = base.birthMonth, lBirth = local.birthMonth, rBirth = remote.birthMonth;
    const birthMonth = same(lBirth, bBirth) ? rBirth : lBirth;
    if (!same(lBirth, bBirth) && !same(rBirth, bBirth) && !same(lBirth, rBirth))
        conflicts.push({ itemId: 'birth-month', field: 'birthMonth', discarded: rBirth ?? null, chosen: lBirth ?? null, at: now });
    const accounts = {};
    for (const id of new Set([...Object.keys(base.cardDebitAccounts ?? {}), ...Object.keys(local.cardDebitAccounts ?? {}), ...Object.keys(remote.cardDebitAccounts ?? {})])) {
        const original = base.cardDebitAccounts?.[id], left = local.cardDebitAccounts?.[id], right = remote.cardDebitAccounts?.[id];
        const next = same(left, original) ? right : left;
        if (next)
            accounts[id] = next;
        if (!same(left, original) && !same(right, original) && !same(left, right))
            conflicts.push({ itemId: 'card-debit-accounts', field: id, discarded: right ?? null, chosen: left ?? null, at: now });
    }
    const bPlan = base.mizuhoTransferPlan, lPlan = local.mizuhoTransferPlan, rPlan = remote.mizuhoTransferPlan;
    const plan = same(lPlan, bPlan) ? rPlan : lPlan;
    if (!same(lPlan, bPlan) && !same(rPlan, bPlan) && !same(lPlan, rPlan))
        conflicts.push({ itemId: 'mizuho-transfer-plan', field: 'mizuhoTransferPlan', discarded: rPlan ?? null, chosen: lPlan ?? null, at: now });
    return validateAssets({ format: 'finance-assets-v1', snapshots: snapshots.entries, recurring: recurring.entries,
        deletedSnapshots: snapshots.deleted, deletedRecurring: recurring.deleted, conflicts: conflicts.slice(-200), nisaCardRule, payrollDepositAccount, payrollAutoPassphrase,
        ...(birthMonth ? { birthMonth } : {}), ...(Object.keys(accounts).length ? { cardDebitAccounts: accounts } : {}), ...(plan ? { mizuhoTransferPlan: plan } : {}), ...(base.oneTime !== undefined || local.oneTime !== undefined || remote.oneTime !== undefined ? { oneTime: oneTimes.entries } : {}),
        ...(base.deletedOneTime !== undefined || local.deletedOneTime !== undefined || remote.deletedOneTime !== undefined ? { deletedOneTime: oneTimes.deleted } : {}) });
}
export function describeAssetsEditCollisions(base, local, remote, collisions) {
    const format = (field, value) => {
        if (field === 'payrollAutoPassphrase')
            return '（セキュリティ保護のため非表示）';
        if (value === undefined || value === null || value === '')
            return '未設定';
        if (value === true)
            return '有効';
        if (value === false)
            return '無効';
        if (typeof value === 'number')
            return Number.isFinite(value) ? `${value.toLocaleString('ja-JP')}${['amount', 'balance'].includes(field) ? '円' : ''}` : '不明';
        if (typeof value === 'string')
            return value.slice(0, 65);
        if (typeof value === 'object')
            return JSON.stringify(value).slice(0, 90);
        return String(value).slice(0, 65);
    };
    const find = (doc, id) => [...doc.snapshots, ...doc.recurring, ...(doc.oneTime ?? [])].find(entry => entry.id === id);
    return collisions.map(item => {
        const present = find(local, item.itemId) ?? find(remote, item.itemId) ?? find(base, item.itemId);
        let label = item.itemId;
        if (present) {
            if ('accountId' in present)
                label = `${ASSET_ACCOUNTS.find(a => a.id === present.accountId)?.name ?? present.accountId}・${present.observedAt.slice(0, 10)}の残高`;
            else if ('date' in present)
                label = `${present.date}・${present.name}`;
            else
                label = `定期入出金「${present.name}」`;
        }
        else if (item.itemId === 'mizuho-transfer-plan')
            label = 'みずほ送金予測';
        else if (item.itemId === 'card-debit-accounts')
            label = `カード引落口座（${CARDS.find(c => c.id === item.field)?.name ?? item.field}）`;
        else if (item.itemId === 'nisa-card-rule')
            label = 'NISAのカード積立';
        else if (item.itemId === 'payroll-deposit-account')
            label = '給与入金先';
        else if (item.itemId === 'payroll-auto-credential')
            label = '給与自動取得の認証';
        else if (item.itemId === 'birth-month')
            label = '生年月';
        const entryFor = (doc) => find(doc, item.itemId);
        let left, right;
        if (present) {
            if (item.field === 'delete') {
                left = entryFor(local) ?? '削除';
                right = entryFor(remote) ?? '削除';
            }
            else {
                left = entryFor(local)?.[item.field];
                right = entryFor(remote)?.[item.field];
            }
        }
        else if (item.itemId === 'card-debit-accounts') {
            left = local.cardDebitAccounts?.[item.field];
            right = remote.cardDebitAccounts?.[item.field];
        }
        else {
            const name = item.field;
            left = local[name];
            right = remote[name];
        }
        return { itemId: item.itemId, field: item.field, label, localValue: format(item.field, left), remoteValue: format(item.field, right) };
    });
}
