import { CARDS, calculatedTotal, getCard } from './models/types.js';
import { parseStatementText } from './importers/statement-parser.js';
import { parsePdfFile } from './importers/pdf-reader.js';
import { planStatementImport, statementSignature } from './importers/import-policy.js';
import { hasVault, unlockVault, readStatements, readOriginal } from './storage/encrypted-vault.js';
import { graphClient, initCloudSettings } from './cloud/cloud-settings.js';
import { LiveVault, CloudWriteUncertainError } from './cloud/live-vault.js';
import { clearTabSession, readTabSession, saveTabSession } from './cloud/tab-session.js';
import { displayMerchant, matchingRule, sortedRules, normalizeMerchant, PALETTE } from './cloud/merchant-rules.js';
import { importErrors, duplicateMonths } from './importers/batch-policy.js';
import { prioritizedIndices, orderedPreviewRows } from './ui/preview-order.js';
import { calendarBillingPeriod, filteredStatementIndices } from './ui/manage-filter.js';
import { recentMerchants } from './ui/recent-merchants.js';
import { planCategoryBatch, categoryBatchChanged } from './ui/category-draft.js';
import { initAssetsSettings } from './ui/assets-settings.js';
import { initFutureProjection } from './ui/future-projection.js'; /* finance-v143 */
import { canonicalStatementFilename } from './ui/statement-filename.js';
import { initMonthlySummary } from './ui/monthly-summary.js'; /* finance-monthly-v140 */
import { initPasswordFields, hidePasswordField, clearPasswordField } from './ui/password-fields.js';
import { readLastView, saveLastView } from './ui/view-preference.js';
const $ = (id) => {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing element #${id}`);
    return node;
};
const yen = (n) => n === null ? '未取得' : `${n.toLocaleString('ja-JP')}円`;
const statements = [];
const failedImports = [];
// Keep the original import fingerprint so editing a row does not change duplicate detection.
const importedSignatures = new WeakMap();
const savedIds = new WeakMap();
// Keep the same remote identity across retries after a partially completed multi-year batch.
const pendingCloudIds = new WeakMap();
// Import is a temporary staging area, independent of all cloud-loaded records.
const importStaged = new WeakSet();
const savedFingerprints = new WeakMap();
const pendingSources = new WeakMap();
const originalSaved = new WeakSet();
const dirty = new WeakSet();
let liveVault = null;
let assetsUi = null;
let futureUi = null;
let summaryUi = null;
let currentModal = null;
let autoSaveTimer;
let cloudStartupRunning = false;
let vaultDiscoveryCompleted = false;
let modalResolve = null;
let activeIndex = -1;
let clipboardHtml = '';
let batchBusy = false;
let filesBusy = false;
let previewSort = null;
let manageSort = null; /* finance-v145 */
const initialCalendar = calendarBillingPeriod();
let manageYear = initialCalendar.year;
let manageMonth = initialCalendar.month;
let manageReturnToSummary = false;
let summaryReturnPageY = 0;
let summaryReturnContentY = 0;
let toastTimeout;
let operationResultTimeout; /* finance-settings-v144 */
let lastSavedAt = null;
let editingRuleId = null;
let rulesBusy = false;
let categoryDraft = null;
let categoryBaseline = [];
let categorySaving = false;
const ruleModes = { exact: '完全一致', prefix: '前方一致', contains: '部分一致' };
function rules() { return liveVault?.unlocked ? liveVault.merchantRules() : []; }
function categories() { return liveVault?.unlocked ? liveVault.merchantCategories() : []; }
function categoryById(id) {
    const item = categories().find(category => category.id === id);
    if (!item)
        return null;
    return { ...item, hex: PALETTE.find(color => color.id === item.color)?.hex ?? '#718096' };
}
function categoryFor(row, s) {
    const matched = matchingRule(row.merchant, s.cardId, rules());
    return categoryById(matched?.categoryId);
}
function categoryChip(meta) {
    const chip = document.createElement('span');
    chip.className = 'category-chip';
    chip.style.setProperty('--category-color', meta.hex);
    const dot = div('category-dot');
    dot.setAttribute('aria-hidden', 'true');
    chip.append(dot, document.createTextNode(meta.name));
    return chip;
}
function merchantFor(row, s) {
    return displayMerchant(row.merchant, s.cardId, rules(), row.merchantOverride);
}
const list = $('statement-list');
const previewEmpty = $('preview-empty');
const previewContent = $('preview-content');
const rowBody = $('transaction-rows');
function active() { return statements[activeIndex]; }
function statementWorkingFingerprint(s) {
    // Issuer fingerprint remains raw for duplicate detection; overrides must be
    // part of the edit fingerprint to avoid losing changes during async uploads.
    return JSON.stringify([statementSignature(s), s.rows.map(r => [r.id, r.merchantOverride ?? null])]);
}
function hasUnsavedChanges(s) {
    return !savedIds.has(s) || dirty.has(s) || savedFingerprints.get(s) !== statementWorkingFingerprint(s);
}
function markDirty(s) {
    dirty.add(s);
    render();
    // Saved statements are sent to OneDrive shortly after a committed field change.
    // New imported drafts still require batch confirmation.
    if (savedIds.has(s)) {
        if (autoSaveTimer)
            clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => { void saveEditedStatement(s); }, 450);
    }
}
function dateDisplay(value) { return value ? value.replace(/-/g, '/') : '未取得'; }
function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
function downloadFile(bytes, mime, filename) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function setBadgeState(className, text) {
    const detailBadge = $('detail-status-pill');
    detailBadge.className = className;
    detailBadge.textContent = text;
}
function balanced(s) { return s.rows.length > 0 && s.statedTotal !== null && s.statedTotal === calculatedTotal(s); }
function issues(s) {
    const errors = importErrors(s, pendingSources.has(s) || originalSaved.has(s));
    const idx = statements.indexOf(s);
    if (idx >= 0 && duplicateMonths(statements).has(idx))
        errors.push('同じカード・請求月が重複しています');
    return errors;
}
function needsReview(s) { return issues(s).length > 0; }
function pending() { return statements.filter(hasUnsavedChanges); }
function importQueue() { return statements.filter(s => importStaged.has(s)); }
function importActive() {
    const statement = active();
    return statement && importStaged.has(statement) ? statement : undefined;
}
function toast(text) {
    const node = $('toast');
    node.textContent = text;
    node.classList.add('visible');
    if (toastTimeout)
        clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => node.classList.remove('visible'), 4500);
}
function operationResult(message, kind = 'good') {
    const element = $('operation-result');
    if (operationResultTimeout) {
        clearTimeout(operationResultTimeout);
        operationResultTimeout = undefined;
    }
    element.className = `operation-result ${kind}`;
    element.textContent = message;
    if (kind === 'good')
        lastSavedAt = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Working state stays until completion; success vanishes. Problems stay long enough to read.
    if (kind !== 'working') {
        operationResultTimeout = setTimeout(() => {
            element.classList.add('hidden');
            operationResultTimeout = undefined;
        }, kind === 'good' ? 4800 : kind === 'warn' ? 10000 : 15000);
    }
}
function sessionStorageSafe() {
    try {
        return window.sessionStorage;
    }
    catch {
        return null;
    }
}
function clearRememberedKey() {
    const store = sessionStorageSafe();
    if (store)
        try {
            clearTabSession(store);
        }
        catch { /* Session storage may be disabled. */ }
}
function clientIdForTab() { return $('cloud-client-id').value.trim(); }
function div(className, content) {
    const node = document.createElement('div');
    node.className = className;
    if (content !== undefined)
        node.textContent = content;
    return node;
}
/** Shared statement card for the import screen and the management screen. */
function createStatementEntry(index, withDelete) {
    const statement = statements[index];
    const state = needsReview(statement) ? 'review' : statement.confirmation === 'provisional' ? 'provisional' : 'verified';
    const entry = div(`statement-entry${withDelete ? ' has-delete' : ''}`);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `statement-card ${state}${index === activeIndex ? ' selected' : ''}`;
    item.setAttribute('aria-pressed', String(index === activeIndex));
    const left = div('statement-main');
    const name = getCard(statement.cardId)?.name ?? `${providerLabel(statement.provider)}（カード確認）`;
    const title = document.createElement('b');
    title.textContent = name;
    const subtitle = document.createElement('small');
    subtitle.textContent = `${statement.billingMonth?.replace('-', '/') ?? '請求月不明'} · ${statement.sourceKind === 'pdf' ? canonicalStatementFilename(statement) : statement.sourceName}`;
    const right = div('statement-end');
    const amount = document.createElement('strong');
    amount.textContent = yen(statement.statedTotal);
    const flag = document.createElement('span');
    flag.className = `statement-flag ${state}`;
    flag.textContent = state === 'review' ? '要確認' : state === 'provisional' ? '暫定明細' : '照合OK';
    // Save state is shown in the batch action / management status, not on every list row.
    right.append(amount, flag);
    left.append(title, subtitle);
    item.append(left, right);
    item.addEventListener('click', () => { activeIndex = index; render(); });
    entry.append(item);
    if (withDelete) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'statement-remove';
        remove.title = '取込待ちの一覧から除外';
        remove.setAttribute('aria-label', `${name} ${statement.billingMonth ?? ''}の取込下書きを除外`);
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
            icon.setAttribute(key, value);
        for (const d of ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 10v7', 'M14 10v7']) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            icon.append(path);
        }
        remove.append(icon);
        remove.disabled = batchBusy;
        remove.addEventListener('click', () => {
            if (withDelete)
                discardImportDraft(index);
            else
                void deleteStatement(index);
        });
        entry.append(remove);
    }
    return entry;
}
function buildStatementList() {
    // A completed import is an empty workspace, not a second statement archive.
    list.closest('.statement-index-panel')?.classList.toggle('is-empty', !importQueue().length && !failedImports.length);
    $('list-count').textContent = `${importQueue().length + failedImports.length}件`;
    list.replaceChildren();
    if (!importQueue().length && !failedImports.length) {
        list.append(div('empty-list', '取込待ちの明細はありません。PDFまたはWeb明細を追加してください。'));
        return;
    }
    for (const [index, message] of failedImports.entries()) {
        const entry = div('statement-entry failed-entry');
        const card = div('statement-card review', `解析失敗 · ${message}`);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'statement-remove';
        remove.textContent = '×';
        remove.title = '失敗した項目を一覧から除外';
        remove.setAttribute('aria-label', '失敗した取込を除外');
        remove.addEventListener('click', () => { failedImports.splice(index, 1); render(); });
        entry.append(card, remove);
        list.append(entry);
    }
    for (const index of prioritizedIndices(statements, s => needsReview(s) ? 0 : s.confirmation === 'provisional' ? 1 : 2)) {
        if (importStaged.has(statements[index]))
            list.append(createStatementEntry(index, true));
    }
}
/** Discard a pending import, never delete its already-stored cloud version. */
function discardImportDraft(index, announce = true) {
    const draft = statements[index];
    if (!draft || !importStaged.has(draft))
        return;
    const storedId = savedIds.get(draft);
    const canonical = storedId ? liveVault?.records().find(record => record.id === storedId) : undefined;
    importStaged.delete(draft);
    if (canonical) {
        const restored = structuredClone(canonical.statement);
        savedIds.set(restored, canonical.id);
        if (canonical.originalId)
            originalSaved.add(restored);
        savedFingerprints.set(restored, statementWorkingFingerprint(restored));
        importedSignatures.set(restored, statementSignature(restored));
        statements.splice(index, 1, restored);
    }
    else {
        statements.splice(index, 1);
        if (activeIndex === index)
            activeIndex = -1;
        else if (activeIndex > index)
            activeIndex--;
    }
    if (announce) {
        render();
        toast('取込待ちの下書きを破棄しました。OneDriveの保存済み明細は変更していません。');
    }
}
async function deleteStatement(index) {
    if (batchBusy || filesBusy)
        return;
    const statement = statements[index];
    if (!statement)
        return;
    const name = getCard(statement.cardId)?.name ?? providerLabel(statement.provider);
    const storedId = savedIds.get(statement);
    const message = `${name}（${statement.billingMonth ?? '請求月不明'}）の明細を削除しますか？` +
        (storedId ? '\nOneDriveの解析済み明細を削除します。' +
            (statement.sourceKind === 'pdf' ? '\n暗号化PDF原本はOneDriveに保持されます。' : '') +
            '\n解析済み明細の削除を元に戻すことはできません。' : '\n未保存の解析結果を破棄します。');
    // Stored records always require confirmation, even when validation currently fails.
    // Only unreviewable, never-saved import drafts may be discarded in one click.
    const mustConfirm = !!storedId || !needsReview(statement);
    if (mustConfirm && !window.confirm(message))
        return;
    batchBusy = true;
    operationResult(storedId ? `${name}の明細をOneDriveから削除中…` : `${name}の下書きを破棄しています…`, 'working');
    render();
    try {
        if (storedId) {
            if (!liveVault?.unlocked)
                throw new Error('OneDrive保管庫を解除してください。');
            await liveVault.delete(storedId);
        }
        const mutationWarning = storedId ? liveVault?.takeMutationWarning() : null;
        const current = statements.indexOf(statement);
        if (current < 0)
            return;
        statements.splice(current, 1);
        if (!statements.length)
            activeIndex = -1;
        else if (activeIndex === current)
            activeIndex = Math.min(current, statements.length - 1);
        else if (current < activeIndex)
            activeIndex--;
        if (!$('manage-view').classList.contains('hidden'))
            selectVisibleManagerStatement();
        if (storedId && !pending().length)
            replaceCloudRecords(liveVault.records());
        updateCloudStatus();
        const result = storedId ? `${name}の明細をOneDriveから削除しました。` : `${name}の未保存下書きを破棄しました。`;
        operationResult(mutationWarning ?? result, mutationWarning ? 'warn' : 'good');
        toast(mutationWarning ?? result);
    }
    catch (error) {
        const unknown = error instanceof CloudWriteUncertainError;
        const result = `${unknown ? '削除結果を確認できません' : '削除できませんでした'}：${error instanceof Error ? error.message : '不明なエラー'}`;
        operationResult(result, unknown ? 'warn' : 'bad');
        toast(result);
    }
    finally {
        batchBusy = false;
        render();
    }
}
function providerLabel(provider) {
    return ({ jcb: 'JCB', rakuten: '楽天カード', view: 'ビューカード', smbc: '三井住友カード系', goldpoint: 'GOLD POINT CARD+', unknown: '不明な発行会社' })[provider];
}
function renderCardOptions(s) {
    const cardSelect = $('manage-card');
    cardSelect.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'カードを選択してください';
    cardSelect.append(blank);
    const candidates = CARDS.filter(card => s.provider === 'unknown' || card.provider === s.provider);
    for (const card of candidates) {
        const option = document.createElement('option');
        option.value = card.id;
        option.textContent = card.name;
        cardSelect.append(option);
    }
    cardSelect.value = s.cardId ?? '';
}
function notice(message, state) {
    const el = div(`notice ${state}`);
    el.textContent = message;
    return el;
}
function renderSummary() {
    const s = importActive();
    if (!s) {
        previewEmpty.classList.remove('hidden');
        previewContent.classList.add('hidden');
        setBadgeState('pill neutral', '待機中');
        return;
    }
    previewEmpty.classList.add('hidden');
    previewContent.classList.remove('hidden');
    $('card-display').textContent = getCard(s.cardId)?.name ?? 'カード未確定';
    $('detail-month').textContent = s.billingMonth ? `${s.billingMonth.slice(0, 4)}年${Number(s.billingMonth.slice(5))}月` : '未取得';
    $('detail-date').textContent = dateDisplay(s.paymentDate);
    $('detail-count').textContent = `${s.rows.length}件`;
    $('amount-stated').textContent = yen(s.statedTotal);
    $('amount-calculated').textContent = yen(calculatedTotal(s));
    const diff = s.statedTotal === null ? null : s.statedTotal - calculatedTotal(s);
    $('amount-diff').textContent = yen(diff);
    $('amount-diff').classList.toggle('negative', diff !== null && diff !== 0);
    if (needsReview(s))
        setBadgeState('pill bad', '要確認');
    else if (s.confirmation === 'provisional')
        setBadgeState('pill info', '暫定明細・照合OK');
    else
        setBadgeState('pill good', '照合OK');
    $('verification-ok').classList.toggle('hidden', !balanced(s));
    const notices = $('notice-list');
    notices.replaceChildren();
    if (!balanced(s) && s.rows.length && s.statedTotal !== null)
        notices.append(notice(`差額が${yen(diff)}あります。金額や未抽出の行を確認してください。`, 'bad'));
    if (!s.cardId && s.provider !== 'unknown')
        notices.append(notice('カードを選択してください。別カードの明細に合算しないための確認です。', 'warn'));
    if (s.confirmation === 'provisional')
        notices.append(notice('請求確定前の明細です。確定後に請求額が変わる場合があります。', 'info'));
    for (const error of issues(s))
        notices.append(notice(error, 'bad'));
    const fixedWarnings = s.warnings.filter(w => !/請求金額と明細合計に差額|対象カードを選択|カードの種類を特定/.test(w));
    for (const w of fixedWarnings)
        notices.append(notice(w, needsReview(s) ? 'bad' : 'warn'));
    $('source-meta').textContent = `${s.sourceKind === 'pdf' ? 'PDF' : 'コピー＆ペースト'} · ${s.sourceKind === 'pdf' ? canonicalStatementFilename(s) : s.sourceName} · 発行元 ${providerLabel(s.provider)}`;
}
function makeInput(value, className, update, ariaLabel) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.className = className;
    input.setAttribute('aria-label', ariaLabel);
    input.addEventListener('change', () => update(input.value));
    return input;
}
function renderSortControls() {
    for (const [key, id] of [['usedOn', 'sort-date'], ['amount', 'sort-amount']]) {
        const button = $(id);
        const direction = previewSort?.key === key ? previewSort.direction : null;
        button.querySelector('.sort-arrow').textContent = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕';
        button.classList.toggle('active', direction !== null);
        button.setAttribute('aria-label', `${key === 'usedOn' ? '利用日' : '当月請求額'}を${direction === 'asc' ? '降順' : '昇順'}に並べ替え`);
        button.title = direction === 'asc' ? '昇順（クリックで降順）' : direction === 'desc' ? '降順（クリックで昇順）' : 'クリックで昇順';
        button.closest('th').setAttribute('aria-sort', direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none');
    }
}
function renderRows() {
    const s = importActive();
    rowBody.replaceChildren();
    renderSortControls();
    if (!s)
        return;
    if (!s.rows.length) {
        const tr = document.createElement('tr'), td = document.createElement('td');
        td.colSpan = 4;
        td.textContent = '取引がありません。明細の管理から修正するか、読み直してください。';
        tr.append(td);
        rowBody.append(tr);
        return;
    }
    for (const row of orderedPreviewRows(s.rows, previewSort)) {
        const tr = document.createElement('tr');
        for (const value of [dateDisplay(row.usedOn), merchantFor(row, s), row.amount.toLocaleString('ja-JP'), row.description || '—']) {
            const td = document.createElement('td');
            td.textContent = value;
            td.title = value;
            tr.append(td);
        }
        tr.children[1].title = row.merchant !== merchantFor(row, s) ? `元の利用先：${row.merchant}` : row.merchant;
        const meta = categoryFor(row, s);
        if (meta) {
            tr.children[1].classList.add('preview-merchant-cell');
            tr.children[1].append(categoryChip(meta));
        }
        tr.children[2].classList.add('amount-cell');
        tr.children[3].classList.add('note');
        rowBody.append(tr);
    }
}
function updateBatchStatus() {
    const drafts = importQueue().filter(hasUnsavedChanges);
    const errors = importQueue().filter(s => issues(s).length > 0);
    const errorCount = errors.length + failedImports.length;
    const button = $('batch-import');
    button.disabled = !drafts.length || errorCount > 0 || batchBusy || filesBusy;
    $('clear-all').classList.toggle('hidden', importQueue().length + failedImports.length === 0);
    button.textContent = batchBusy ? 'OneDriveに保存中…' : drafts.length ? `明細 ${drafts.length}件を一括取り込む` : '明細を一括取り込む';
    $('batch-status').textContent = errorCount
        ? `${errorCount}件にエラーがあります` : drafts.length ? `${drafts.length}件をまとめて取り込み` : '取込対象はありません';
    $('batch-description').textContent = errorCount
        ? 'エラーのある明細は「明細の管理」で修正するか、一覧から除外してください。全件の取込を停止しています。'
        : drafts.length ? 'この一覧にある取込待ちの明細を、まとめてOneDriveに保存します。'
            : '新しいPDFやWeb明細を追加してください。保存済みのデータは「明細の管理」で確認できます。';
}
function render() {
    buildStatementList();
    renderSummary();
    renderRows();
    updateBatchStatus();
    if (!$('manage-view').classList.contains('hidden'))
        renderManager();
    if (!$('rules-view').classList.contains('hidden'))
        renderRules();
    if (!$('summary-view').classList.contains('hidden'))
        summaryUi?.render();
    if (!$('future-view').classList.contains('hidden'))
        futureUi?.render();
}
function attachSource(statement, source) {
    if (source)
        pendingSources.set(statement, source);
}
function replaceCloudRecords(records) {
    // Never discard an unsaved local draft while reloading remote data.
    if (pending().length && statements.length)
        throw new Error('未保存の編集があるため再読み込みできません。');
    statements.splice(0);
    activeIndex = -1;
    for (const record of records) {
        const statement = record.statement;
        savedIds.set(statement, record.id);
        if (record.originalId)
            originalSaved.add(statement);
        savedFingerprints.set(statement, statementWorkingFingerprint(statement));
        importedSignatures.set(statement, statementSignature(statement));
        statements.push(statement);
    }
    if (statements.length)
        activeIndex = 0;
    render();
}
function appendCloudRecordsKeepingDrafts(records) {
    const drafts = statements.filter(hasUnsavedChanges);
    statements.splice(0);
    for (const record of records) {
        const statement = record.statement;
        savedIds.set(statement, record.id);
        if (record.originalId)
            originalSaved.add(statement);
        savedFingerprints.set(statement, statementWorkingFingerprint(statement));
        importedSignatures.set(statement, statementSignature(statement));
        statements.push(statement);
    }
    for (const draft of drafts) {
        // A committed item is now canonical; only preserve unsaved new/edited drafts.
        if (!statements.some(record => savedIds.get(record) === savedIds.get(draft) && savedIds.has(draft)))
            statements.unshift(draft);
    }
    activeIndex = statements.length ? 0 : -1;
    render();
}
function updateCloudStatus(message) {
    const label = $('cloud-live-status');
    const bar = $('cloud-live-bar');
    const state = !liveVault ? '未接続' : liveVault.unlocked ? '接続済み' : !vaultDiscoveryCompleted ? '確認中' : liveVault.exists ? 'ロック中' : '保管庫なし';
    // New vault creation is an explicit action, never a side effect of refresh.
    $('cloud-new-vault').classList.toggle('hidden', !liveVault || !vaultDiscoveryCompleted || liveVault.exists || liveVault.unlocked);
    label.textContent = `OneDrive：${state}`;
    // Keep the global bar quiet when connected. Only missing access or an error needs attention.
    const failure = message && /失敗|エラー|不備|接続してください|未保存|更新確認/.test(message);
    bar.textContent = failure ? message : liveVault?.unlocked ? '' : `OneDrive：${state}`;
    $('cloud-live-migrate').classList.toggle('hidden', !liveVault);
}
/** The values are shown only in a local browser confirmation, never transmitted. */
const collisionLabel = {
    balance: '残高', observedAt: '残高確認日時', amount: '金額', usedOn: '利用日', merchant: '利用先', description: '補足',
    merchantOverride: '表示名', statedTotal: '請求総額', paymentDate: '引落日', billingMonth: '請求月',
    name: '名称', displayName: '表示名', pattern: '一致文字列', patterns: '一致候補', mode: '一致方法',
    categoryId: 'カテゴリー', color: '色', enabled: '有効・無効', status: '状態', priority: '優先順位',
    date: '日付', delete: '削除と編集', cardDebitAccounts: 'カード引落口座',
    nisaCardRule: 'NISAのカード積立', payrollDepositAccount: '給与の入金先', payrollAutoPassphrase: '給与の自動取得設定',
    birthMonth: '生年月', mizuhoTransferPlan: 'みずほ送金予測',
};
function collisionValue(value) {
    if (value === undefined || value === null || value === '')
        return '未設定';
    if (typeof value === 'number')
        return value.toLocaleString('ja-JP');
    if (typeof value === 'string')
        return value.slice(0, 75);
    return JSON.stringify(value).slice(0, 90);
}
function confirmCloudConflicts(title, rows) {
    const details = rows.slice(0, 5).map(item => `・${item.label} / ${collisionLabel[item.field] ?? item.field}\n  この端末：${item.local}\n  OneDrive：${item.remote}`).join('\n');
    const suffix = rows.length > 5 ? `\nほか${rows.length - 5}項目` : '', info = `${title}（${rows.length}件）\n${details}${suffix}\n\n［OK］この端末の変更を採用して保存\n［キャンセル］保存せずOneDriveの値を保持`;
    return window.confirm(info);
}
async function startCloud() {
    if (cloudStartupRunning || liveVault?.unlocked)
        return;
    cloudStartupRunning = true;
    vaultDiscoveryCompleted = false;
    try {
        const client = await graphClient();
        liveVault = new LiveVault(client);
        liveVault.setAssetConflictResolver((collisions, details = []) => confirmCloudConflicts('資産設定に同時編集があります', collisions.map((item, i) => ({ label: details[i]?.label ?? item.itemId, field: item.field,
            local: details[i]?.localValue ?? '変更あり', remote: details[i]?.remoteValue ?? '別端末で変更あり' }))));
        liveVault.setStatementConflictResolver(collisions => confirmCloudConflicts('カード明細に同時編集があります', collisions.map(item => ({ label: `明細 ${item.recordId.slice(0, 12)} / ${item.path.replace(/^record\.statement\./, '')}`,
            field: item.path.split('.').at(-1) ?? item.path, local: collisionValue(item.local), remote: collisionValue(item.remote) }))));
        liveVault.setRuleConflictResolver(collisions => confirmCloudConflicts('利用先ルール・カテゴリーに同時編集があります', collisions.map(item => ({ label: item.ruleId.startsWith('category:') ? `カテゴリー ${item.ruleId.slice(9)}` : `利用先ルール ${item.ruleId.slice(0, 16)}`,
            field: item.field, local: collisionValue(item.local), remote: collisionValue(item.remote) }))));
        assetsUi?.render();
        futureUi?.render();
        const exists = await liveVault.discover();
        vaultDiscoveryCompleted = true;
        updateCloudStatus();
        if (exists) {
            const store = sessionStorageSafe();
            const saved = store ? readTabSession(store, clientIdForTab()) : null;
            let restored = false;
            if (saved) {
                try {
                    await liveVault.unlockTab(saved.salt, saved.key, saved.dataSetId ?? null);
                    appendCloudRecordsKeepingDrafts(liveVault.records());
                    renderRules();
                    assetsUi?.render();
                    futureUi?.render();
                    void assetsUi?.refreshPayroll();
                    updateCloudStatus();
                    operationResult(`このタブの一時鍵で自動復号しました（${liveVault.records().length}件）。`);
                    restored = true;
                }
                catch {
                    clearRememberedKey();
                }
            }
            if (!restored)
                await askVault('unlock');
        }
        else {
            if (!readLastView(sessionStorageSafe()))
                showView('settings');
            updateCloudStatus();
            operationResult('現在のMicrosoftアカウントのアプリ領域にFinance保管庫が見つかりません。既存データを探している場合は、MicrosoftアカウントとClient IDを確認してください。', 'bad');
        }
    }
    catch (error) {
        if (!readLastView(sessionStorageSafe()))
            showView('settings');
        updateCloudStatus(`OneDriveに接続してください：${error instanceof Error ? error.message : '接続エラー'}`);
    }
    finally {
        cloudStartupRunning = false;
    }
}
async function refreshCloud() {
    if (!liveVault || !vaultDiscoveryCompleted)
        await startCloud();
    if (!liveVault || !vaultDiscoveryCompleted)
        throw new Error('Microsoftアカウントの認証と保管庫の確認を完了してください。');
    if (!liveVault.exists)
        throw new Error('このMicrosoftアカウントのアプリ領域に保管庫がありません。接続先アカウントとClient IDを確認してください。新規作成は実行していません。');
    if (!liveVault.unlocked) {
        if (!await askVault('unlock'))
            throw new Error('既存保管庫のロック解除をキャンセルしました。');
        return;
    }
    if (pending().length || failedImports.length)
        throw new Error('未保存の明細があります。保存または破棄してから更新してください。');
    replaceCloudRecords(await liveVault.refresh());
    renderRules();
    assetsUi?.render();
    futureUi?.render();
    void assetsUi?.refreshPayroll();
    updateCloudStatus('OneDriveから最新の明細を取得しました。');
}
async function migrateLegacy() {
    if (!liveVault)
        await startCloud();
    if (!liveVault)
        throw new Error('OneDriveへの接続が必要です。');
    // IndexedDB is accessed ONLY when the user explicitly requests old-data migration.
    if (!await hasVault())
        throw new Error('このブラウザには旧IndexedDBの明細がありません。別の端末・URLでは引き継げません。');
    if (liveVault.exists && !liveVault.unlocked) {
        if (!await askVault('unlock'))
            return;
    }
    if (!window.confirm('旧IndexedDBの明細とPDFを暗号化してOneDriveへ移行します。旧データは削除しません。すでに移行済みの明細IDは上書きしません。続行しますか？'))
        return;
    await askVault('migrate');
}
/** Mobile disclosure uses one state source for buttons, assistive tech and keyboard access. */
function setMobileMenuOpen(requested) {
    const isMobile = window.matchMedia('(max-width: 800px)').matches;
    const expanded = requested && isMobile;
    const sidebar = document.getElementById('finance-sidebar');
    const toggle = document.getElementById('mobile-nav-toggle');
    const panel = document.getElementById('mobile-nav-panel');
    sidebar?.classList.toggle('mobile-open', expanded);
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'メニューを閉じる' : 'メニューを開く');
        toggle.title = expanded ? 'メニューを閉じる' : 'メニューを開く';
    }
    if (panel)
        panel.inert = isMobile && !expanded;
}
function showView(view) {
    setMobileMenuOpen(false);
    if (view !== 'manage')
        manageReturnToSummary = false;
    $('manage-back-summary').classList.toggle('hidden', view !== 'manage' || !manageReturnToSummary);
    $('import-view').classList.toggle('hidden', view !== 'import');
    $('manage-view').classList.toggle('hidden', view !== 'manage');
    $('rules-view').classList.toggle('hidden', view !== 'rules');
    $('settings-view').classList.toggle('hidden', view !== 'settings');
    $('assets-page').classList.toggle('hidden', view !== 'assets');
    $('future-view').classList.toggle('hidden', view !== 'future'); /* finance-v148 */
    $('summary-view').classList.toggle('hidden', view !== 'summary');
    // The overview already shows the cloud state; avoid repeating the global banner.
    $('cloud-live-bar').classList.toggle('hidden', view === 'settings');
    for (const mode of ['import', 'manage', 'summary', 'rules', 'assets', 'future', 'settings']) {
        const nav = $(`nav-${mode}`);
        nav.classList.toggle('active', view === mode);
        if (view === mode)
            nav.setAttribute('aria-current', 'page');
        else
            nav.removeAttribute('aria-current');
    }
    if (view === 'import' && !importActive()) {
        activeIndex = statements.findIndex(s => importStaged.has(s));
    }
    if (view === 'manage') {
        selectVisibleManagerStatement();
        renderManager();
    }
    if (view === 'import')
        render();
    if (view === 'rules') {
        renderRules();
    }
    if (view === 'assets')
        assetsUi?.render();
    if (view === 'future')
        futureUi?.render();
    if (view === 'summary')
        summaryUi?.render();
    // Switching menus always starts the destination at its top. Explicit
    // 'back to summary' navigation restores its captured position afterward.
    const content = document.querySelector('.workspace > .content');
    if (content)
        content.scrollTop = 0;
    window.scrollTo(0, 0);
    saveLastView(sessionStorageSafe(), view);
}
function managerIndices() {
    return filteredStatementIndices(statements, manageYear, manageMonth);
}
function selectVisibleManagerStatement() {
    const indices = managerIndices();
    if (!indices.includes(activeIndex))
        activeIndex = indices[0] ?? -1;
}
function setOptions(select, choices, selected) {
    // Reuse the existing option nodes where possible: changes should not reset focus.
    const current = choices.map(([value]) => value).join('|');
    const previous = Array.from(select.options).map(option => option.value).join('|');
    if (current !== previous) {
        select.replaceChildren(...choices.map(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            return option;
        }));
    }
    select.value = selected;
}
function renderManagerFilters() {
    const picker = $('manage-period');
    picker.value = manageYear === 'all' || manageMonth === 'all' ? '' : `${manageYear}-${manageMonth}`;
    $('manage-show-all').classList.toggle('active', manageYear === 'all' && manageMonth === 'all');
    return managerIndices();
}
function manageChangePeriod(period) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
        return;
    manageYear = period.slice(0, 4);
    manageMonth = period.slice(5);
    selectVisibleManagerStatement();
    renderManager();
}
function manageShiftMonth(offset) {
    const current = manageYear !== 'all' && manageMonth !== 'all' ? `${manageYear}-${manageMonth}` :
        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const year = Number(current.slice(0, 4)), month = Number(current.slice(5, 7));
    const target = new Date(Date.UTC(year, month - 1 + offset, 1));
    manageChangePeriod(`${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`);
}
function renderManager() {
    const indices = renderManagerFilters();
    $('manage-list-count').textContent = `${indices.length}件`;
    const managerList = $('manage-list');
    managerList.replaceChildren();
    for (const index of indices)
        managerList.append(createStatementEntry(index, false));
    if (!indices.length)
        managerList.append(div('empty-list', statements.length ? 'この年月の明細はありません。' : '明細がありません。'));
    if (!indices.includes(activeIndex))
        activeIndex = indices[0] ?? -1;
    const s = indices.includes(activeIndex) ? active() : undefined;
    const empty = $('manage-empty');
    empty.classList.toggle('hidden', !!s);
    empty.querySelector('h3').textContent = indices.length ? '編集する明細を選択してください' : '該当する明細がありません';
    $('manage-content').classList.toggle('hidden', !s);
    if (!s)
        return;
    renderCardOptions(s);
    $('manage-month').value = s.billingMonth ?? '';
    $('manage-payment').value = dateDisplay(s.paymentDate).replace('未取得', '');
    $('manage-status').textContent = hasUnsavedChanges(s) ? 'OneDrive未保存' : `OneDrive保存済み${lastSavedAt ? ` · ${lastSavedAt}` : ''}`;
    const originalButton = $('manage-original-download');
    const savedId = savedIds.get(s);
    originalButton.disabled = batchBusy || filesBusy || !liveVault?.unlocked || !savedId ||
        !liveVault.records().some(record => record.id === savedId && !!record.originalId);
    originalButton.title = s.sourceKind === 'pdf' ? '復号したPDFが端末のダウンロード先に保存されます。' : 'Web貼り付け明細にPDF原本はありません。';
    $('manage-save').disabled = batchBusy || filesBusy;
    $('manage-delete').disabled = batchBusy || filesBusy;
    const errorMessages = issues(s);
    $('manage-validation').textContent = errorMessages.length ? `要修正：${errorMessages.join(' / ')}` : '検証OK。保存済み明細の変更は自動反映されます。';
    for (const [key, id, label] of [['usedOn', 'manage-sort-date', '利用日'], ['amount', 'manage-sort-amount', '金額']]) {
        const button = $(id);
        const active = manageSort?.key === key;
        button.textContent = `${label} ${active ? (manageSort.direction === 'asc' ? '▲' : '▼') : '↕'}`;
        button.closest('th')?.setAttribute('aria-sort', active ? (manageSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    }
    const body = $('manage-rows');
    body.replaceChildren();
    // Sorting is display-only: deletions must continue to address original row indices.
    for (const { index, row } of orderedPreviewRows(s.rows.map((row, index) => ({ row, index, usedOn: row.usedOn, amount: row.amount })), manageSort)) {
        const tr = document.createElement('tr');
        const fields = [
            [dateDisplay(row.usedOn), '利用日', value => {
                    const next = value.trim().replace(/\//g, '-');
                    if (!validDate(next)) {
                        toast('利用日は YYYY/MM/DD で入力してください');
                        renderManager();
                        return;
                    }
                    row.usedOn = next;
                    markDirty(s);
                }],
            [merchantFor(row, s), '利用先', value => {
                    const requested = value.trim();
                    const defaultDisplay = displayMerchant(row.merchant, s.cardId, rules());
                    if (!requested || requested === defaultDisplay || requested === row.merchant)
                        delete row.merchantOverride;
                    else
                        row.merchantOverride = requested;
                    markDirty(s);
                }],
            [row.amount.toLocaleString('ja-JP'), '金額', value => {
                    if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value.trim())) {
                        toast('金額は整数で入力してください');
                        renderManager();
                        return;
                    }
                    row.amount = Number(value.replace(/,/g, ''));
                    markDirty(s);
                }],
            [row.description ?? '', '補足', value => { row.description = value.trim(); markDirty(s); }],
        ];
        for (const [value, aria, update] of fields) {
            const td = document.createElement('td');
            td.dataset.label = aria;
            const field = makeInput(value, aria === '金額' ? 'numeric-input' : '', update, aria);
            if (aria === '利用先') {
                const cell = div('manage-merchant-control manage-merchant-quiet');
                const main = div('manage-merchant-main');
                main.append(field);
                cell.append(main);
                const secondary = div('manage-merchant-secondary');
                const category = categoryFor(row, s);
                if (category)
                    secondary.append(categoryChip(category));
                else
                    secondary.append(div('category-chip manage-uncategorized', '未分類'));
                const currentDisplay = merchantFor(row, s).trim();
                const originalMerchant = row.merchant.trim();
                if (originalMerchant && currentDisplay !== originalMerchant) {
                    const original = div('manage-source-text', `原文：${row.merchant}`);
                    original.title = row.merchant;
                    secondary.append(original);
                }
                if (secondary.childElementCount)
                    cell.append(secondary);
                td.append(cell);
            }
            else
                td.append(field);
            tr.append(td);
            if (aria === '金額')
                td.classList.add('amount-cell');
        }
        const td = document.createElement('td');
        td.dataset.label = '操作';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'manage-row-delete';
        remove.textContent = '削除';
        remove.addEventListener('click', () => { s.rows.splice(index, 1); markDirty(s); });
        td.append(remove);
        tr.append(td);
        body.append(tr);
    }
}
function updateRuleCategoryVisual() {
    const selected = $('rule-category').value;
    const category = categoryById(selected);
    const dot = $('rule-category-dot');
    dot.style.setProperty('--category-color', category?.hex ?? '#718096');
    dot.classList.toggle('is-empty', !category);
}
function fillRuleCategoryOptions() {
    const select = $('rule-category');
    const selected = select.value;
    select.replaceChildren(new Option('分類しない', ''));
    for (const category of categories()) {
        const color = PALETTE.find(item => item.id === category.color);
        const option = new Option(`${category.name}（${color?.name ?? '灰'}）`, category.id);
        option.style.color = color?.hex ?? '';
        select.add(option);
    }
    select.value = categories().some(category => category.id === selected) ? selected : '';
    updateRuleCategoryVisual();
}
function syncRuleModeRadios() {
    const mode = $('rule-mode').value;
    document.querySelectorAll('input[name="rule-mode-choice"]').forEach(radio => {
        radio.checked = radio.value === mode;
    });
}
function rulePatternInputs() {
    return Array.from($('rule-pattern-alternatives').querySelectorAll('input[data-rule-alternative]'));
}
function renderRulePatternAlternatives(values) {
    const container = $('rule-pattern-alternatives');
    container.replaceChildren();
    for (const value of values) {
        const row = div('rule-pattern-row');
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 200;
        input.value = value;
        input.placeholder = '追加の利用先名';
        input.dataset.ruleAlternative = 'true';
        input.autocomplete = 'off';
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.spellcheck = false;
        // Explicit 1Password opt-out: this is a merchant string, never a credential.
        input.setAttribute('data-1p-ignore', 'true');
        input.setAttribute('aria-label', '追加の利用先名');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'rule-pattern-remove';
        remove.textContent = '削除';
        remove.setAttribute('aria-label', 'この利用先を削除');
        remove.addEventListener('click', () => { row.remove(); $('rule-pattern-add').disabled = rulePatternInputs().length >= 19; });
        row.append(input, remove);
        container.append(row);
    }
    $('rule-pattern-add').disabled = values.length >= 19;
}
function addRulePatternAlternative() {
    const existing = rulePatternInputs();
    if (existing.length >= 19)
        return;
    renderRulePatternAlternatives([...existing.map(item => item.value), '']);
    const latest = rulePatternInputs();
    latest[latest.length - 1]?.focus();
}
function resetRuleEditor() {
    editingRuleId = null;
    $('rules-editor-title').textContent = '新しいルール';
    $('rules-form').reset();
    renderRulePatternAlternatives([]);
    $('rule-card').value = '';
    $('rule-category').value = '';
    updateRuleCategoryVisual();
    $('rule-priority').value = '100';
    $('rule-enabled').checked = true;
    $('rule-save').textContent = '保存';
}
function populateRuleEditor(rule) {
    editingRuleId = rule.id;
    $('rules-editor-title').textContent = 'ルールの編集';
    $('rule-pattern').value = rule.pattern;
    renderRulePatternAlternatives(rule.patterns ?? []);
    $('rule-mode').value = rule.mode;
    syncRuleModeRadios();
    $('rule-display-name').value = rule.displayName;
    $('rule-card').value = rule.cardId ?? '';
    fillRuleCategoryOptions();
    $('rule-category').value = rule.categoryId ?? '';
    updateRuleCategoryVisual();
    $('rule-priority').value = String(rule.priority);
    $('rule-enabled').checked = rule.enabled;
    $('rule-save').textContent = '保存';
    $('rule-pattern').focus();
    $('rules-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function openRuleForRow(row, s) {
    resetRuleEditor();
    showView('rules');
    $('rule-pattern').value = row.merchant;
    $('rule-mode').value = 'exact';
    syncRuleModeRadios();
    $('rule-display-name').value = row.merchantOverride ?? matchingRule(row.merchant, s.cardId, rules())?.displayName ?? '';
    $('rule-card').value = '';
    $('rule-category').value = matchingRule(row.merchant, s.cardId, rules())?.categoryId ?? '';
    updateRuleCategoryVisual();
    $('rule-display-name').focus();
}
function proposedRule() {
    const patterns = [$('rule-pattern').value, ...rulePatternInputs().map(input => input.value)].map(p => p.trim()).filter(Boolean); /* finance-v147 */
    const pattern = patterns[0] ?? '';
    if (patterns.length > 20 || patterns.some(p => p.length > 200) ||
        new Set(patterns.map(normalizeMerchant)).size !== patterns.length)
        return null;
    const displayName = $('rule-display-name').value;
    const priority = Number($('rule-priority').value);
    if (!normalizeMerchant(pattern) || !displayName.trim() || !Number.isSafeInteger(priority) || priority < 0 || priority > 1000)
        return null;
    return { id: editingRuleId ?? 'preview-rule', pattern, ...(patterns.length > 1 ? { patterns: patterns.slice(1) } : {}), mode: $('rule-mode').value,
        displayName, cardId: $('rule-card').value || null, enabled: $('rule-enabled').checked, priority,
        categoryId: ($('rule-category').value || null) };
}
function renderRules() {
    const unlocked = !!liveVault?.unlocked;
    $('rules-lock-message').classList.toggle('hidden', unlocked);
    $('rules-workspace').classList.toggle('hidden', !unlocked);
    if (!unlocked)
        return;
    fillRuleCategoryOptions();
    const current = sortedRules(rules());
    $('rules-list-count').textContent = `${current.length}件`;
    const list = $('rules-list');
    list.replaceChildren();
    if (!current.length)
        list.append(div('empty-list', '利用先ルールはまだありません。左のフォームから登録できます。'));
    for (const rule of current) {
        const item = div(`rules-item${rule.enabled ? '' : ' rules-disabled'}`);
        const top = div('rules-item-top'), main = div('rules-item-main');
        const heading = div('rules-item-heading');
        const name = div('rules-item-name', rule.displayName);
        const source = div('rules-item-source', `${[rule.pattern, ...(rule.patterns ?? [])].join(' / ')} · ${ruleModes[rule.mode]}`);
        heading.append(name, source);
        main.append(heading);
        const card = rule.cardId ? getCard(rule.cardId)?.name ?? rule.cardId : '全カード';
        const metaLine = div('rules-item-meta-line');
        metaLine.append(div('rules-item-meta', `${card} · 優先 ${rule.priority}`));
        const category = categoryById(rule.categoryId);
        if (category)
            metaLine.append(categoryChip(category));
        main.append(metaLine);
        top.append(main, div('rules-tag', rule.enabled ? '有効' : '無効'));
        item.append(top);
        const buttons = div('rules-item-actions');
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '編集';
        edit.disabled = rulesBusy;
        edit.addEventListener('click', () => populateRuleEditor(rule));
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.disabled = rulesBusy;
        toggle.textContent = rule.enabled ? '無効にする' : '有効にする';
        toggle.addEventListener('click', () => { void saveRule({ ...rule, enabled: !rule.enabled }); });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'rules-remove';
        remove.textContent = '削除';
        remove.disabled = rulesBusy;
        remove.addEventListener('click', () => { void deleteRule(rule); });
        buttons.append(edit, toggle, remove);
        item.append(buttons);
        list.append(item);
    }
}
/** Edit the entire list in a modal; no cloud writes or main screen rerenders until Save. */
function openCategoryDialog() {
    if (!liveVault?.unlocked || rulesBusy)
        return;
    categoryBaseline = categories().map(item => ({ ...item }));
    categoryDraft = categoryBaseline.map(item => ({ ...item }));
    $('rules-category-name').value = '';
    $('rules-category-color').value = 'blue';
    renderCategoryDraft();
    $('categories-dialog').showModal();
}
function categoryPlan() {
    if (!categoryDraft)
        return { upserts: [], removeIds: [] };
    return planCategoryBatch(categoryBaseline, categoryDraft);
}
function updateCategoryDraftStatus() {
    const status = $('rules-category-status');
    try {
        const changes = categoryPlan();
        const n = changes.upserts.length + changes.removeIds.length;
        status.textContent = n ? `${n}件の変更があります。保存するとOneDriveへまとめて反映されます。` : '変更はありません。';
        status.classList.remove('bad');
        $('categories-dialog-save').disabled = categorySaving || !categoryBatchChanged(changes);
    }
    catch (error) {
        status.textContent = error instanceof Error ? error.message : '入力を確認してください。';
        status.classList.add('bad');
        $('categories-dialog-save').disabled = true;
    }
}
function renderCategoryDraft() {
    const box = $('rules-category-list');
    box.replaceChildren();
    if (!categoryDraft)
        return;
    for (const item of categoryDraft) {
        const row = div('rules-category-row');
        const swatch = div('rules-category-dot');
        const paint = () => swatch.style.setProperty('--category-color', PALETTE.find(c => c.id === item.color)?.hex ?? '#718096');
        paint();
        const name = document.createElement('input');
        name.type = 'text';
        name.maxLength = 60;
        name.value = item.name;
        name.setAttribute('aria-label', `${item.name}の名前`);
        name.addEventListener('input', () => { item.name = name.value; updateCategoryDraftStatus(); });
        const select = document.createElement('select');
        select.setAttribute('aria-label', `${item.name}の色`);
        for (const color of PALETTE)
            select.add(new Option(color.name, color.id));
        select.value = item.color;
        select.addEventListener('change', () => { item.color = select.value; paint(); updateCategoryDraftStatus(); });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'category-delete';
        remove.textContent = '削除';
        remove.setAttribute('aria-label', `${item.name}を削除予定にする`);
        remove.addEventListener('click', () => { categoryDraft = categoryDraft.filter(c => c.id !== item.id); renderCategoryDraft(); });
        name.disabled = select.disabled = remove.disabled = categorySaving;
        row.append(swatch, name, select, remove);
        box.append(row);
    }
    if (!categoryDraft.length)
        box.append(div('empty-list', 'カテゴリーはありません。下から追加してください。'));
    $('rules-category-add').disabled = categorySaving;
    $('categories-dialog-cancel').disabled = categorySaving;
    $('categories-dialog-close').disabled = categorySaving;
    $('rules-category-name').disabled = categorySaving;
    $('rules-category-color').disabled = categorySaving;
    updateCategoryDraftStatus();
}
function addDraftCategory() {
    if (!categoryDraft || categorySaving)
        return;
    const input = $('rules-category-name');
    const name = input.value.trim();
    if (!name) {
        input.focus();
        $('rules-category-status').textContent = '追加するカテゴリー名を入力してください。';
        return;
    }
    categoryDraft.push({ id: `cat-${crypto.randomUUID()}`, name, color: $('rules-category-color').value });
    input.value = '';
    renderCategoryDraft();
    input.focus();
}
function closeCategoryDialog() {
    if (categorySaving)
        return;
    if (categoryDraft) {
        let changed = true;
        try {
            changed = categoryBatchChanged(categoryPlan());
        }
        catch {
            changed = true;
        }
        if (changed && !window.confirm('保存していないカテゴリーの変更を破棄しますか？'))
            return;
    }
    categoryDraft = null;
    categoryBaseline = [];
    $('categories-dialog').close();
}
async function saveCategoryDialog() {
    if (categorySaving || rulesBusy || !liveVault?.unlocked || !categoryDraft)
        return;
    let changes;
    try {
        changes = categoryPlan();
    }
    catch (error) {
        updateCategoryDraftStatus();
        return;
    }
    if (!categoryBatchChanged(changes))
        return;
    categorySaving = true;
    rulesBusy = true;
    renderCategoryDraft();
    $('rules-category-status').textContent = 'OneDriveにカテゴリーを一括保存中…';
    try {
        await liveVault.applyCategoryBatch(changes);
        categoryDraft = null;
        categoryBaseline = [];
        $('categories-dialog').close();
        operationResult('カテゴリーをまとめてOneDriveに保存しました。');
        render();
    }
    catch (error) {
        const status = $('rules-category-status');
        status.textContent = `保存失敗：${error instanceof Error ? error.message : '通信エラー'}。編集内容は残っています。`;
        status.classList.add('bad');
        operationResult('カテゴリーの一括保存に失敗しました。編集内容は保持しています。', 'bad');
    }
    finally {
        rulesBusy = false;
        categorySaving = false;
        if (categoryDraft) {
            const status = $('rules-category-status');
            const failure = status.classList.contains('bad') ? status.textContent : null;
            renderCategoryDraft();
            if (failure) {
                status.textContent = failure;
                status.classList.add('bad');
            }
        }
        renderRules();
    }
}
/** Picker is read-only: selecting a merchant fills the predicate field only. */
function renderRecentMerchants() {
    const candidates = recentMerchants(statements.filter(s => savedIds.has(s) && !importStaged.has(s)));
    const card = $('recent-merchants-card').value;
    const search = normalizeMerchant($('recent-merchants-search').value);
    const filtered = candidates.filter(item => (!card || item.cardId === card) && (!search || normalizeMerchant(item.merchant).includes(search)));
    const list = $('recent-merchants-list');
    list.replaceChildren();
    $('recent-merchants-count').textContent = `該当 ${filtered.length}件（最新60件を表示）`;
    for (const item of filtered.slice(0, 60)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-merchant-item';
        const name = document.createElement('strong');
        name.textContent = item.merchant;
        const detail = document.createElement('small');
        detail.textContent = `${getCard(item.cardId)?.name ?? 'カード不明'} · 最終利用 ${item.lastDate || '不明'} · ${item.count}回`;
        button.append(name, detail);
        button.addEventListener('click', () => {
            $('rule-pattern').value = item.merchant;
            $('recent-merchants-dialog').close();
            $('rule-pattern').focus();
        });
        list.append(button);
    }
    if (!filtered.length)
        list.append(div('empty-list', '該当する利用先がありません。過去の保存済み明細を確認してください。'));
}
function openRecentMerchants() {
    const picker = $('recent-merchants-card');
    picker.value = $('rule-card').value;
    $('recent-merchants-search').value = '';
    renderRecentMerchants();
    $('recent-merchants-dialog').showModal();
    $('recent-merchants-search').focus();
}
async function saveRule(rule) {
    if (rulesBusy || !liveVault?.unlocked)
        return;
    rulesBusy = true;
    $('rule-save').disabled = true;
    $('rules-sync-status').className = 'rules-sync-status';
    $('rules-sync-status').textContent = 'OneDriveへ利用先ルールを保存中…';
    try {
        await liveVault.upsertMerchantRule(rule);
        if (editingRuleId === rule.id)
            resetRuleEditor();
        $('rules-sync-status').textContent = 'OneDriveに利用先ルールを保存しました。過去の明細にも反映済みです。';
        operationResult('利用先ルールをOneDriveに保存しました。');
        render();
    }
    catch (error) {
        $('rules-sync-status').className = 'rules-sync-status bad';
        $('rules-sync-status').textContent = `利用先ルールの保存失敗：${error instanceof Error ? error.message : '不明なエラー'}`;
        operationResult('利用先ルールを保存できませんでした。内容を保持しています。', 'bad');
    }
    finally {
        rulesBusy = false;
        $('rule-save').disabled = false;
        renderRules();
    }
}
async function deleteRule(rule) {
    if (rulesBusy || !liveVault?.unlocked)
        return;
    if (!window.confirm(`利用先ルール「${rule.pattern} → ${rule.displayName}」を削除しますか？\n元のカード明細は変更されません。`))
        return;
    rulesBusy = true;
    try {
        $('rules-sync-status').textContent = 'OneDriveからルールを削除中…';
        await liveVault.removeMerchantRule(rule.id);
        if (editingRuleId === rule.id)
            resetRuleEditor();
        $('rules-sync-status').textContent = 'OneDriveからルールを削除しました。';
        operationResult('利用先ルールを削除しました。');
        render();
    }
    catch (error) {
        $('rules-sync-status').className = 'rules-sync-status bad';
        $('rules-sync-status').textContent = `削除失敗：${error instanceof Error ? error.message : '不明なエラー'}`;
        operationResult('利用先ルールを削除できませんでした。', 'bad');
    }
    finally {
        rulesBusy = false;
        renderRules();
    }
}
async function refreshVaultControls() {
    updateCloudStatus();
    $('preview-empty').querySelector('p').textContent = liveVault?.unlocked
        ? '上のエリアからPDFを選ぶか、Web明細を貼り付けてください。'
        : 'OneDriveに接続し、暗号化保管庫を解除すると保存済みの明細が表示されます。';
}
function modalClose(success) {
    const dlg = $('vault-dialog');
    if (dlg.open)
        dlg.close();
    clearPasswordField('vault-passphrase');
    clearPasswordField('vault-passphrase-confirm');
    currentModal = null;
    modalResolve?.(success);
    modalResolve = null;
}
function askVault(mode) {
    if ($('vault-dialog').open)
        return Promise.resolve(false);
    return new Promise(resolve => {
        modalResolve = resolve;
        currentModal = mode;
        $('vault-error').textContent = '';
        $('vault-confirm-group').classList.toggle('hidden', mode !== 'create');
        $('vault-tab-option').classList.toggle('hidden', mode === 'migrate');
        $('vault-tab-keep').checked = false;
        const pass = $('vault-passphrase');
        pass.minLength = mode === 'create' ? 12 : 1;
        pass.autocomplete = mode === 'create' ? 'new-password' : 'current-password';
        hidePasswordField('vault-passphrase');
        hidePasswordField('vault-passphrase-confirm');
        $('vault-dialog-title').textContent = mode === 'create' ? 'OneDrive保管庫の新規作成' : mode === 'migrate' ? '旧データをOneDriveへ移行' : 'OneDrive保管庫のロック解除';
        $('vault-dialog-copy').textContent = mode === 'create'
            ? 'OneDriveに暗号化保管庫を作成します。12文字以上のパスフレーズを1Passwordに保存してください。'
            : mode === 'migrate' ? '旧ブラウザ保存に使ったパスフレーズを入力します。移行後も同じパスフレーズでOneDriveを解除できます。'
                : liveVault?.needsLayoutMigration
                    ? '旧v1.0の保管庫が見つかりました。復号後、年別フォルダへ暗号化データとPDFを安全に移行します。旧データは削除しません。移行完了後は古いv1.0からの編集を避けてください。'
                    : 'OneDriveの暗号化明細を取得しました。1Passwordから専用パスフレーズを入力してください。';
        $('vault-submit').textContent = mode === 'create' ? '暗号化保管庫を作成' : mode === 'migrate' ? '暗号化して移行' : '復号して開く';
        $('vault-dialog').showModal();
        pass.focus();
    });
}
async function ensureUnlocked() {
    if (liveVault?.unlocked)
        return true;
    if (!liveVault)
        await startCloud();
    if (liveVault?.unlocked)
        return true;
    if (!liveVault)
        return false;
    return askVault(liveVault.exists ? 'unlock' : 'create');
}
async function downloadManagedOriginal() {
    const s = active();
    const id = s ? savedIds.get(s) : undefined;
    if (!s || !id || !liveVault?.unlocked) {
        toast('保存済みのPDF原本を選択してください。');
        return;
    }
    const button = $('manage-original-download');
    if (button.disabled)
        return;
    button.disabled = true;
    try {
        const bytes = await liveVault.original(id);
        if (!bytes)
            throw new Error('この明細のPDF原本は保存されていません。');
        downloadFile(new Uint8Array(bytes).buffer, 'application/pdf', canonicalStatementFilename(s, id));
        toast('暗号化PDF原本を復号し、統一ファイル名でダウンロードしました。');
    }
    catch (error) {
        toast(`PDF原本の取得に失敗しました：${error instanceof Error ? error.message : '不明なエラー'}`);
    }
    finally {
        button.disabled = false;
    }
}
async function saveEditedStatement(s, manual = false) {
    if (!savedIds.has(s))
        return;
    if (!hasUnsavedChanges(s)) {
        if (manual) {
            operationResult('変更はありません。OneDriveに保存済みです。');
            toast('この明細はOneDriveに保存済みです。');
        }
        return;
    }
    if (batchBusy || filesBusy) {
        if (manual)
            operationResult('別の保存処理中です。変更は未保存のまま保持しています。', 'working');
        autoSaveTimer = setTimeout(() => { void saveEditedStatement(s); }, 650);
        return;
    }
    if (issues(s).length) {
        updateCloudStatus('変更内容に不備があります。修正してから保存してください。');
        operationResult('内容に不備があるため、OneDriveへの保存を保留しています。', 'warn');
        return;
    }
    if (!liveVault?.unlocked) {
        updateCloudStatus('ロック中のため変更は未保存です。');
        operationResult('保管庫がロック中のため未保存です。', 'warn');
        return;
    }
    batchBusy = true;
    updateBatchStatus();
    operationResult('変更内容をOneDriveへ保存中…', 'working');
    const fingerprint = statementWorkingFingerprint(s);
    try {
        const id = savedIds.get(s);
        await liveVault.saveBatch([{ id, statement: structuredClone(s), source: s.sourceKind === 'pdf' ? pendingSources.get(s) : undefined }]);
        const mutationWarning = liveVault.takeMutationWarning();
        if (statementWorkingFingerprint(s) === fingerprint) {
            savedFingerprints.set(s, fingerprint);
            dirty.delete(s);
            pendingSources.delete(s);
            importStaged.delete(s);
            if (s.sourceKind === 'pdf')
                originalSaved.add(s);
            if (!pending().length)
                replaceCloudRecords(liveVault.records());
        }
        else {
            autoSaveTimer = setTimeout(() => { void saveEditedStatement(s); }, 550);
        }
        if (!hasUnsavedChanges(s)) {
            updateCloudStatus(mutationWarning ?? '変更をOneDriveに保存しました。');
            operationResult(mutationWarning ?? '変更内容をOneDriveに保存しました。', mutationWarning ? 'warn' : 'good');
            toast(mutationWarning ?? '変更内容をOneDriveに保存しました。');
        }
        else
            operationResult('追加の変更を検出しました。続けて保存しています…', 'working');
    }
    catch (error) {
        const uncertain = error instanceof CloudWriteUncertainError;
        const result = `${uncertain ? '保存結果を確認できません' : '保存失敗（未保存の変更を保持中）'}：${error instanceof Error ? error.message : '不明なエラー'}`;
        updateCloudStatus(result);
        operationResult(result, uncertain ? 'warn' : 'bad');
        toast(result);
    }
    finally {
        batchBusy = false;
        render();
    }
}
async function saveAllPending() {
    if (batchBusy || filesBusy)
        return;
    const candidates = importQueue().filter(hasUnsavedChanges);
    if (!candidates.length)
        return;
    const invalidCount = importQueue().filter(s => issues(s).length).length + failedImports.length;
    if (invalidCount) {
        toast(`不備のある明細が${invalidCount}件あります。修正してから保存してください。`);
        return;
    }
    batchBusy = true;
    updateBatchStatus();
    operationResult(`${candidates.length}件の明細をOneDriveへ暗号化保存中…`, 'working');
    try {
        if (!await ensureUnlocked()) {
            operationResult('ロック解除がキャンセルされました。明細は未保存です。', 'warn');
            return;
        }
        const latest = importQueue().filter(hasUnsavedChanges);
        if (!latest.length)
            return;
        const fingerprints = latest.map(s => statementWorkingFingerprint(s));
        const ids = await liveVault.saveBatch(latest.map(s => {
            let id = savedIds.get(s) ?? pendingCloudIds.get(s);
            if (!id) {
                id = crypto.randomUUID();
                pendingCloudIds.set(s, id);
            }
            return { id, statement: structuredClone(s), source: s.sourceKind === 'pdf' ? pendingSources.get(s) : undefined };
        }));
        for (const [index, s] of latest.entries()) {
            savedIds.set(s, ids[index]);
            if (statementWorkingFingerprint(s) === fingerprints[index]) {
                savedFingerprints.set(s, fingerprints[index]);
                dirty.delete(s);
                pendingSources.delete(s);
                importStaged.delete(s);
                if (s.sourceKind === 'pdf')
                    originalSaved.add(s);
            }
        }
        if (!pending().length)
            replaceCloudRecords(liveVault.records());
        let mutationWarning = liveVault.takeMutationWarning();
        try {
            await refreshVaultControls();
        }
        catch {
            mutationWarning = mutationWarning ?? 'OneDriveへの保存は完了しましたが、画面の更新に失敗しました。最新データを取得してください。';
        }
        const remaining = importQueue().length;
        const message = remaining
            ? `${latest.length - remaining}件をOneDriveに保存しました。残り${remaining}件は未確定です。`
            : `${latest.length}件の明細をOneDriveに暗号化保存しました。`;
        operationResult(mutationWarning ?? message, mutationWarning || remaining ? 'warn' : 'good');
        toast(mutationWarning ?? message);
    }
    catch (error) {
        const uncertain = error instanceof CloudWriteUncertainError;
        const message = `${uncertain ? '一括保存結果を確認できません' : '一括保存に失敗しました'}：${error instanceof Error ? error.message : '不明なエラー'}`;
        updateCloudStatus(message);
        operationResult(message, uncertain ? 'warn' : 'bad');
        toast(message);
    }
    finally {
        batchBusy = false;
        render();
    }
}
function acceptStatement(s, source) {
    if (batchBusy) {
        toast('保存処理中は追加できません。');
        return;
    }
    const decision = planStatementImport(statements, s, existing => importedSignatures.get(existing) ?? statementSignature(existing));
    if (decision.kind === 'duplicate') {
        activeIndex = importStaged.has(statements[decision.index]) ? decision.index : -1;
        render();
        toast('同一内容の明細はすでに取り込まれています。保存済み明細は「明細の管理」で確認できます。');
        return;
    }
    if (decision.kind === 'revision') {
        const existing = statements[decision.index];
        const label = getCard(s.cardId)?.name ?? providerLabel(s.provider);
        // Re-imported revisions are queued for the single batch commit.
        // Previously edited rows are not overwritten without review in Manage.
        if (dirty.has(existing)) {
            activeIndex = decision.index;
            render();
            toast('未保存の修正があるため上書きせずに残しました。明細の管理で確認してください。');
            return;
        }
        statements[decision.index] = s;
        const oldId = savedIds.get(existing);
        if (oldId) {
            savedIds.set(s, oldId);
            savedFingerprints.set(s, savedFingerprints.get(existing) ?? statementWorkingFingerprint(existing));
            dirty.add(s);
            if (originalSaved.has(existing))
                originalSaved.add(s);
        }
        attachSource(s, source);
        importedSignatures.set(s, statementSignature(s));
        importStaged.add(s);
        activeIndex = decision.index;
        render();
        toast(`${label}の${s.billingMonth}分を更新しました（旧: ${yen(existing.statedTotal)} → 新: ${yen(s.statedTotal)}）。`);
        return;
    }
    importedSignatures.set(s, statementSignature(s));
    attachSource(s, source);
    importStaged.add(s);
    statements.unshift(s);
    activeIndex = 0;
    render();
    toast(`${getCard(s.cardId)?.name ?? providerLabel(s.provider)}の明細を解析しました（${s.rows.length}件）。`);
}
async function handleFiles(files) {
    filesBusy = true;
    updateBatchStatus();
    try {
        for (const file of Array.from(files)) {
            if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
                failedImports.push(`${file.name}: PDF形式ではありません`);
                render();
                toast('PDF形式のファイルを選択してください。');
                continue;
            }
            try {
                const result = await parsePdfFile(file);
                acceptStatement(result, { bytes: new Uint8Array(await file.arrayBuffer()), mime: 'application/pdf' });
            }
            catch (error) {
                const reason = `${file.name}: ${error instanceof Error ? error.message : '読み込みに失敗しました。'}`;
                failedImports.push(reason);
                toast(reason);
                render();
            }
        }
    }
    finally {
        filesBusy = false;
        render();
    }
}
const THEME_KEY = 'finance-theme';
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
function getThemeMode() {
    try {
        const value = localStorage.getItem(THEME_KEY);
        return value === 'light' || value === 'dark' ? value : 'system';
    }
    catch {
        return 'system';
    }
}
function applyTheme(mode) {
    document.documentElement.dataset.theme = mode === 'system' ? (darkMedia.matches ? 'dark' : 'light') : mode;
}
function initTheme() {
    const picker = $('theme-mode');
    const mobileToggle = document.getElementById('mobile-theme-toggle');
    const syncIcon = () => {
        if (!mobileToggle)
            return;
        const dark = document.documentElement.dataset.theme === 'dark';
        const message = dark ? 'ライトモードに切り替える' : 'ダークモードに切り替える';
        mobileToggle.setAttribute('aria-label', message);
        mobileToggle.title = message;
    };
    picker.value = getThemeMode();
    applyTheme(picker.value);
    syncIcon();
    picker.addEventListener('change', () => {
        const value = picker.value;
        try {
            if (value === 'system')
                localStorage.removeItem(THEME_KEY);
            else
                localStorage.setItem(THEME_KEY, value);
        }
        catch { /* Storage may be unavailable in private browsing. */ }
        applyTheme(value);
        syncIcon();
    });
    // On phones the icon switches explicit light/dark modes; desktop retains system mode.
    mobileToggle?.addEventListener('click', () => {
        picker.value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        picker.dispatchEvent(new Event('change'));
    });
    darkMedia.addEventListener('change', () => {
        if (picker.value === 'system')
            applyTheme('system');
        syncIcon();
    });
}
function init() {
    initPasswordFields();
    initTheme();
    const mobileToggle = document.getElementById('mobile-nav-toggle');
    const mobileBreakpoint = window.matchMedia('(max-width: 800px)');
    setMobileMenuOpen(false);
    mobileToggle?.addEventListener('click', () => {
        setMobileMenuOpen(!document.getElementById('finance-sidebar')?.classList.contains('mobile-open'));
    });
    mobileBreakpoint.addEventListener('change', () => setMobileMenuOpen(false));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('finance-sidebar')?.classList.contains('mobile-open')) {
            setMobileMenuOpen(false);
            mobileToggle?.focus();
        }
    });
    document.addEventListener('pointerdown', event => {
        const sidebar = document.getElementById('finance-sidebar');
        if (sidebar?.classList.contains('mobile-open') && event.target instanceof Node && !sidebar.contains(event.target))
            setMobileMenuOpen(false);
    });
    futureUi = initFutureProjection(() => !liveVault?.unlocked ? null : { assets: liveVault.assetSettings(), records: liveVault.records() }, async (birthMonth) => { if (!liveVault?.unlocked)
        throw Error('保管庫を解除してください。'); await liveVault.setBirthMonth(birthMonth); });
    assetsUi = initAssetsSettings(() => liveVault, categories, message => {
        operationResult(message);
        summaryUi?.render();
        futureUi?.render();
    }, () => summaryUi?.render());
    summaryUi = initMonthlySummary({
        source: () => {
            if (!liveVault?.unlocked)
                return null;
            return { records: liveVault.records(), rules: liveVault.merchantRules(),
                categories: liveVault.merchantCategories(), assets: liveVault.assetSettings(),
                payroll: assetsUi?.payrollSnapshot() ?? { ready: false, syncedAt: null, entries: [] } };
        },
        openRecord: (id) => {
            const index = statements.findIndex(s => savedIds.get(s) === id);
            if (index < 0) {
                toast('該当する明細が見つかりません。OneDriveを更新してください。');
                return;
            }
            const billing = statements[index]?.billingMonth;
            manageYear = billing && /^\d{4}-(0[1-9]|1[0-2])$/.test(billing) ? billing.slice(0, 4) : 'all';
            manageMonth = manageYear === 'all' ? 'all' : billing.slice(5);
            activeIndex = index;
            summaryReturnPageY = window.scrollY;
            const content = document.querySelector('.workspace .content');
            summaryReturnContentY = content?.scrollTop ?? 0;
            manageReturnToSummary = true;
            showView('manage');
            if (content)
                content.scrollTop = 0;
            window.scrollTo(0, 0);
        },
    });
    $('cloud-new-vault').addEventListener('click', () => {
        void (async () => {
            try {
                if (cloudStartupRunning || !liveVault || !vaultDiscoveryCompleted)
                    throw new Error('先に接続先の保管庫を確認してください。');
                const nowExists = await liveVault.discover();
                vaultDiscoveryCompleted = true;
                updateCloudStatus();
                if (nowExists) {
                    operationResult('既存の保管庫が見つかりました。新規作成せずに解除してください。');
                    await askVault('unlock');
                    return;
                }
                const answer = window.confirm('現在接続しているMicrosoftアカウントのアプリ領域にFinance保管庫が見つかりません。\n\n既存のFinanceデータを探している場合は、新規作成せずアカウントとClient IDを確認してください。\n\nこのアカウントに新しい保管庫を作成しますか？');
                if (answer)
                    await askVault('create');
            }
            catch (error) {
                operationResult(`保管庫の確認に失敗しました：${error instanceof Error ? error.message : '通信エラー'}`, 'bad');
            }
        })();
    });
    initCloudSettings({
        onChangePassphrase: async (current, next, onProgress) => {
            if (!liveVault?.unlocked)
                throw new Error('先にOneDrive保管庫をロック解除してください。');
            if (pending().length || failedImports.length || assetsUi?.isBusy() || assetsUi?.isDirty() || statements.some(s => hasUnsavedChanges(s)) || rulesBusy || categorySaving || batchBusy || filesBusy || autoSaveTimer)
                throw new Error('未保存の明細・編集中のデータがあります。保存または破棄してから変更してください。');
            await liveVault.changePassphrase(current, next, onProgress);
            clearRememberedKey();
            replaceCloudRecords(liveVault.records());
            renderRules();
            assetsUi?.render();
            futureUi?.render();
            updateCloudStatus('OneDrive：新しい暗号化パスフレーズに更新しました。');
            operationResult('暗号化パスフレーズを変更しました。すべての有効データを新しい鍵で再暗号化しました。');
        },
        onRefresh: refreshCloud,
        onMigration: migrateLegacy,
        onLock: () => {
            if (liveVault?.isRotating || assetsUi?.isBusy())
                return false;
            if ((pending().length || assetsUi?.isDirty()) && !window.confirm('未保存の編集があります。破棄してロックしますか？'))
                return false;
            clearRememberedKey();
            liveVault?.lock();
            summaryUi?.reset();
            futureUi?.reset();
            statements.splice(0);
            failedImports.splice(0);
            activeIndex = -1;
            render();
            renderRules();
            assetsUi?.reset();
            updateCloudStatus();
            return true;
        },
    });
    for (const [key, id] of [['usedOn', 'sort-date'], ['amount', 'sort-amount']]) {
        $(id).addEventListener('click', () => {
            previewSort = { key, direction: previewSort?.key === key && previewSort.direction === 'asc' ? 'desc' : 'asc' };
            renderRows();
        });
    }
    $('nav-import').addEventListener('click', () => showView('import'));
    $('nav-manage').addEventListener('click', () => { manageReturnToSummary = false; showView('manage'); });
    $('manage-back-summary').addEventListener('click', () => {
        showView('summary');
        const content = document.querySelector('.workspace .content');
        if (content)
            content.scrollTop = summaryReturnContentY;
        window.scrollTo(0, summaryReturnPageY);
    });
    $('manage-original-download').addEventListener('click', () => { void downloadManagedOriginal(); });
    $('nav-summary').addEventListener('click', () => showView('summary'));
    $('nav-rules').addEventListener('click', () => showView('rules'));
    $('nav-assets').addEventListener('click', () => showView('assets'));
    $('nav-future').addEventListener('click', () => showView('future'));
    $('nav-settings').addEventListener('click', () => showView('settings'));
    for (const [key, id] of [['usedOn', 'manage-sort-date'], ['amount', 'manage-sort-amount']]) {
        $(id).addEventListener('click', () => {
            manageSort = { key, direction: manageSort?.key === key && manageSort.direction === 'asc' ? 'desc' : 'asc' };
            renderManager();
        });
    }
    $('manage-prev-month').addEventListener('click', () => manageShiftMonth(-1));
    $('manage-next-month').addEventListener('click', () => manageShiftMonth(1));
    $('manage-current-month').addEventListener('click', () => manageChangePeriod(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`));
    $('manage-show-all').addEventListener('click', () => {
        manageYear = 'all';
        manageMonth = 'all';
        selectVisibleManagerStatement();
        renderManager();
    });
    $('manage-period').addEventListener('change', event => manageChangePeriod(event.target.value));
    for (const card of CARDS) {
        const opt = document.createElement('option');
        opt.value = card.id;
        opt.textContent = card.name;
        $('rule-card').append(opt);
        const recentOption = document.createElement('option');
        recentOption.value = card.id;
        recentOption.textContent = card.name;
        $('recent-merchants-card').append(recentOption);
    }
    for (const color of PALETTE)
        $('rules-category-color').add(new Option(color.name, color.id));
    $('rules-category-color').value = 'blue';
    $('rules-category-add').addEventListener('click', addDraftCategory);
    $('rules-pick-merchant').addEventListener('click', openRecentMerchants);
    $('rules-category-jump').addEventListener('click', openCategoryDialog);
    $('categories-dialog-close').addEventListener('click', closeCategoryDialog);
    $('categories-dialog-cancel').addEventListener('click', closeCategoryDialog);
    $('categories-dialog-save').addEventListener('click', () => { void saveCategoryDialog(); });
    $('categories-dialog').addEventListener('cancel', event => { event.preventDefault(); closeCategoryDialog(); });
    $('recent-merchants-close').addEventListener('click', () => $('recent-merchants-dialog').close());
    $('recent-merchants-dialog').addEventListener('click', event => {
        if (event.target === $('recent-merchants-dialog'))
            $('recent-merchants-dialog').close();
    });
    $('recent-merchants-card').addEventListener('change', renderRecentMerchants);
    $('recent-merchants-search').addEventListener('input', renderRecentMerchants);
    $('rule-category').addEventListener('change', updateRuleCategoryVisual);
    $('rule-reset').addEventListener('click', resetRuleEditor);
    document.querySelectorAll('input[name="rule-mode-choice"]').forEach(radio => radio.addEventListener('change', () => {
        if (radio.checked)
            $('rule-mode').value = radio.value;
    }));
    $('rule-pattern-add').addEventListener('click', addRulePatternAlternative);
    $('rules-form').addEventListener('submit', event => {
        event.preventDefault();
        const candidate = proposedRule();
        if (!candidate) {
            toast('利用先ルールの入力内容を確認してください。');
            return;
        }
        // Use a stable ID so a failed upload can be retried without duplicating it.
        if (!editingRuleId) {
            editingRuleId = crypto.randomUUID();
            candidate.id = editingRuleId;
        }
        void saveRule(candidate);
    });
    $('rules-reload').addEventListener('click', () => {
        if (!liveVault?.unlocked || rulesBusy)
            return;
        void (async () => {
            try {
                await refreshCloud();
                renderRules();
                $('rules-sync-status').textContent = 'OneDriveから最新のルールを取得しました。';
            }
            catch (error) {
                $('rules-sync-status').textContent = `更新失敗：${error instanceof Error ? error.message : '通信エラー'}`;
            }
        })();
    });
    $('batch-import').addEventListener('click', () => { void saveAllPending(); });
    $('manage-save').addEventListener('click', () => { const s = active(); if (s) {
        if (savedIds.has(s)) {
            if (autoSaveTimer)
                clearTimeout(autoSaveTimer);
            void saveEditedStatement(s, true);
        }
        else
            void saveAllPending();
    } });
    $('manage-delete').addEventListener('click', () => { if (activeIndex >= 0)
        void deleteStatement(activeIndex); });
    $('manage-add-row').addEventListener('click', () => { const s = active(); if (!s)
        return; s.rows.push({ id: crypto.randomUUID(), usedOn: new Date().toISOString().slice(0, 10), merchant: '', amount: 0 }); markDirty(s); });
    $('manage-month').addEventListener('change', e => { const s = active(); if (!s)
        return; s.billingMonth = e.target.value || null; if (s.billingMonth && manageYear !== 'all') {
        manageYear = s.billingMonth.slice(0, 4);
        manageMonth = 'all';
    } markDirty(s); });
    $('manage-payment').addEventListener('change', e => { const s = active(); if (!s)
        return; const val = e.target.value.trim().replace(/\//g, '-'); s.paymentDate = val || null; markDirty(s); });
    $('file-input').addEventListener('change', event => {
        const input = event.target;
        if (input.files)
            void handleFiles(input.files);
        input.value = '';
    });
    const dropzone = $('dropzone');
    dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        $('file-input').click();
    } });
    dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', event => {
        event.preventDefault();
        dropzone.classList.remove('dragover');
        if (event.dataTransfer?.files)
            void handleFiles(event.dataTransfer.files);
    });
    const pasteInput = $('paste-input');
    pasteInput.addEventListener('paste', event => { clipboardHtml = event.clipboardData?.getData('text/html') ?? ''; });
    $('parse-paste').addEventListener('click', () => {
        if (!pasteInput.value.trim()) {
            toast('明細を貼り付けてください。');
            return;
        }
        const s = parseStatementText(pasteInput.value, 'paste', 'Web明細の貼り付け', clipboardHtml);
        acceptStatement(s); // Web paste saves the parsed rows; the raw copied text is not retained.
        // Remove unnecessary copies from the textarea; the parsed draft lives only in memory.
        pasteInput.value = '';
        clipboardHtml = '';
    });
    $('manage-card').addEventListener('change', event => {
        const s = active();
        if (!s)
            return;
        s.cardId = event.target.value || null;
        const chosen = getCard(s.cardId);
        if (chosen)
            s.provider = chosen.provider;
        // An account/month collision is shown as an error and blocks the batch.
        markDirty(s);
    });
    $('clear-all').addEventListener('click', () => {
        const drafts = importQueue();
        if (!drafts.length && !failedImports.length) {
            toast('破棄できる取込待ちの明細はありません。');
            return;
        }
        if (!window.confirm(`取込待ちの明細${drafts.length}件と解析失敗${failedImports.length}件を破棄しますか？\nOneDriveに保存済みの明細は削除されません。`))
            return;
        for (const draft of drafts)
            discardImportDraft(statements.indexOf(draft), false);
        failedImports.splice(0);
        activeIndex = -1;
        render();
        toast('未保存の明細を破棄しました。');
    });
    $('vault-cancel').addEventListener('click', () => modalClose(false));
    $('vault-dialog').addEventListener('cancel', event => { event.preventDefault(); modalClose(false); });
    $('vault-form').addEventListener('submit', event => {
        event.preventDefault();
        void (async () => {
            const mode = currentModal;
            if (!mode)
                return;
            const pass = $('vault-passphrase').value;
            const confirmPass = $('vault-passphrase-confirm').value;
            const keepTab = mode !== 'migrate' && $('vault-tab-keep').checked;
            const submit = $('vault-submit');
            $('vault-error').textContent = '';
            if (mode === 'create' && pass !== confirmPass) {
                $('vault-error').textContent = '確認用パスフレーズが一致しません。';
                return;
            }
            submit.disabled = true;
            try {
                if (!liveVault)
                    throw new Error('Microsoftアカウントへの接続が必要です。');
                if (mode === 'create')
                    await liveVault.create(pass, keepTab);
                else if (mode === 'migrate') {
                    await unlockVault(pass);
                    const legacy = await readStatements();
                    // Read and validate the full old source before creating the live vault.
                    const data = [];
                    for (const item of legacy) {
                        const original = item.hasSource ? await readOriginal(item.id) : null;
                        data.push({ id: item.id, statement: item.statement, ...(original ? { source: { bytes: original.bytes, mime: original.mime } } : {}) });
                    }
                    if (!liveVault.exists)
                        await liveVault.create(pass);
                    const existing = new Set(liveVault.records().map(x => x.id));
                    const unimported = data.filter(x => !existing.has(x.id));
                    if (unimported.length)
                        await liveVault.saveBatch(unimported);
                    toast(`旧明細${data.length}件中、${unimported.length}件をOneDriveへ移行しました。旧データは削除していません。`);
                }
                else {
                    const layoutMigration = liveVault.needsLayoutMigration;
                    await liveVault.unlock(pass, keepTab);
                    if (layoutMigration)
                        toast('旧OneDrive保管庫を年別構造へ移行しました。旧ファイルも保持しています。');
                }
                if (keepTab) {
                    const store = sessionStorageSafe();
                    if (!store)
                        throw new Error('このブラウザではタブ内セッション保存を利用できません。チェックを外して解除してください。');
                    const exported = await liveVault.exportTabKey();
                    try {
                        saveTabSession(store, clientIdForTab(), exported.salt, exported.key, Date.now(), exported.dataSetId);
                    }
                    catch {
                        throw new Error('タブ内セッションを保存できませんでした。チェックを外してもう一度解除してください。');
                    }
                }
                else
                    clearRememberedKey();
                modalClose(true);
                appendCloudRecordsKeepingDrafts(liveVault.records());
                renderRules();
                assetsUi?.render();
                futureUi?.render();
                void assetsUi?.refreshPayroll();
                updateCloudStatus();
                await refreshVaultControls();
                if (mode === 'unlock')
                    toast(`OneDriveから${liveVault.records().length}件を復号しました。`);
            }
            catch (error) {
                $('vault-error').textContent = error instanceof Error ? error.message : '認証できませんでした。';
            }
            finally {
                submit.disabled = false;
            }
        })();
    });
    const lastView = readLastView(sessionStorageSafe());
    if (lastView)
        showView(lastView);
    void refreshVaultControls();
    render();
    void startCloud();
    window.addEventListener('focus', () => { if (liveVault?.unlocked && !liveVault.isRotating && !pending().length && !batchBusy)
        void refreshCloud().catch(error => updateCloudStatus(`更新確認失敗：${error instanceof Error ? error.message : '通信エラー'}`)); });
    window.addEventListener('beforeunload', event => {
        if (batchBusy || pending().length || liveVault?.isRotating || assetsUi?.isBusy() || assetsUi?.isDirty()) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
}
init();
