import { ASSET_ACCOUNTS, latestBalance, validateRecurring, validateSnapshot, validateNisaCardRule, validateOneTime } from '../cloud/assets.js';
import { CARDS } from '../models/types.js';
import { lastDayOfNextMonth, localDay, matchingNisaRows } from '../cloud/asset-projection.js';
import { forecastBankBalances } from '../cloud/salary-projection.js';
import { estimateMizuhoTransferAmount } from '../cloud/mizuho-transfer.js';
import { DEFAULT_MIZUHO_PLAN } from '../cloud/assets.js'; /* finance-v148 */
import { PayrollReadSession } from '../cloud/payroll-bridge.js';
import { incomeByMonth } from '../cloud/payroll-income.js';
const $ = (id) => {
    const value = document.getElementById(id);
    if (!value)
        throw new Error(`Missing assets UI #${id}`);
    return value;
};
const accountName = (id) => ASSET_ACCOUNTS.find(a => a.id === id)?.name ?? '未設定';
const yen = (value) => `${value.toLocaleString('ja-JP')}円`;
const localDate = (date = new Date()) => {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 10);
};
function make(tag, className, content) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (content !== undefined)
        node.textContent = content;
    return node;
}
const assetStatusTimers = new WeakMap(); /* finance-settings-v144 */
function status(node, message, error = false) {
    const old = assetStatusTimers.get(node);
    if (old)
        clearTimeout(old);
    assetStatusTimers.delete(node);
    node.textContent = message;
    node.classList.toggle('bad', error);
    // Informational/finished actions disappear; errors and important warnings remain.
    if (!error && /保存しました|取得しました|削除しました|解除しました|更新しました|完了しました/.test(message)
        && !/二重計上|注意|失敗/.test(message)) {
        const timer = setTimeout(() => { if (node.textContent === message)
            node.textContent = ''; assetStatusTimers.delete(node); }, 5000);
        assetStatusTimers.set(node, timer);
    }
}
function addButton(label, handler, remove = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = remove ? 'assets-item-button danger' : 'assets-item-button';
    button.addEventListener('click', handler);
    return button;
}
const kindName = { expense: '支出', income: '収入', transfer: '振替' };
const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
function frequencyLabel(e) {
    if (e.frequency === 'weekly')
        return `毎週${weekdayLabels[e.weekday ?? 0]}曜日`;
    const day = e.dayOfMonth === 0 ? '末日' : `${e.dayOfMonth}日`;
    return e.frequency === 'monthly' ? `毎月${day}` : `毎年${e.monthOfYear}月${day}`;
}
export function initAssetsSettings(getVault, getCategories, onSaved, onPayrollChange = () => { }) {
    let busy = false, dirty = false, nisaDirty = false, editingId = null;
    let payrollSession = null;
    let payrollIncome = [];
    let payrollSynced = false, payrollBusy = false, payrollAccountDirty = false;
    let payrollSyncedAt = 0, lastPayrollAttemptAt = 0;
    let payrollOwner = null;
    const amounts = new Map();
    const latestTexts = new Map();
    const histories = new Map();
    const accountDetails = new Map();
    let cardDebitAccountsDirty = false;
    let onceEditingId = null, onceDirty = false, onceShowAll = false;
    const editing = () => !!editingId;
    const value = (id) => $(id).value;
    const choices = (select, options) => {
        select.replaceChildren(...options.map(o => new Option(o.label, o.value)));
    };
    const requireVault = () => {
        const vault = getVault();
        if (!vault?.unlocked)
            throw new Error('OneDrive保管庫を解除してください。');
        return vault;
    };
    function toggleBusy(next) {
        busy = next;
        for (const button of $('assets-workspace').querySelectorAll('button'))
            button.disabled = busy;
        if (!busy) {
            const linkButton = document.getElementById('assets-nisa-disable');
            if (linkButton)
                linkButton.disabled = !getVault()?.unlocked || !getVault()?.assetSettings().nisaCardRule;
        }
    }
    function markDirty() { dirty = true; }
    function resetForm() {
        editingId = null;
        $('assets-recurring-form').reset();
        $('assets-recurring-start').value = localDate();
        $('assets-recurring-end').value = '';
        $('assets-recurring-frequency').value = 'monthly';
        $('assets-recurring-month').value = String(new Date().getMonth() + 1);
        $('assets-recurring-weekday').value = String(new Date().getDay());
        $('assets-recurring-day').value = String(new Date().getDate());
        $('assets-recurring-kind').value = 'expense';
        $('assets-recurring-from').value = 'rakuten-bank';
        $('assets-recurring-to').value = 'cash-savings';
        $('assets-recurring-category').value = '';
        $('assets-recurring-enabled').checked = true;
        $('assets-recurring-form-title').textContent = '定期入出金を追加';
        $('assets-recurring-save').textContent = '保存';
        updateFormFields();
        dirty = false;
    }
    function updateFormFields() {
        const frequency = value('assets-recurring-frequency');
        const kind = value('assets-recurring-kind');
        $('assets-month-wrap').classList.toggle('hidden', frequency !== 'yearly');
        $('assets-weekday-wrap').classList.toggle('hidden', frequency !== 'weekly');
        $('assets-recurring-day').closest('label').classList.toggle('hidden', frequency === 'weekly');
        $('assets-recurring-from').closest('label').classList.toggle('hidden', kind === 'income');
        $('assets-recurring-to').closest('label').classList.toggle('hidden', kind === 'expense');
        $('assets-category-wrap').classList.toggle('hidden', kind !== 'expense');
    }
    function readEntry() {
        const frequency = value('assets-recurring-frequency');
        const kind = value('assets-recurring-kind');
        const from = value('assets-recurring-from');
        const to = value('assets-recurring-to');
        const amount = Number(value('assets-recurring-amount'));
        const entry = {
            id: editingId ?? crypto.randomUUID(), name: value('assets-recurring-name').trim(), amount, kind,
            fromAccountId: kind === 'income' ? null : from, toAccountId: kind === 'expense' ? null : to,
            frequency, dayOfMonth: frequency === 'weekly' ? null : Number(value('assets-recurring-day')),
            monthOfYear: frequency === 'yearly' ? Number(value('assets-recurring-month')) : null,
            weekday: frequency === 'weekly' ? Number(value('assets-recurring-weekday')) : null,
            startOn: value('assets-recurring-start'), endOn: value('assets-recurring-end') || null,
            categoryId: kind === 'expense' ? value('assets-recurring-category') || null : null,
            enabled: $('assets-recurring-enabled').checked,
        };
        return validateRecurring(entry);
    }
    function populateForm(item) {
        editingId = item.id;
        dirty = true;
        $('assets-recurring-name').value = item.name;
        $('assets-recurring-amount').value = String(item.amount);
        $('assets-recurring-kind').value = item.kind;
        $('assets-recurring-from').value = item.fromAccountId ?? 'rakuten-bank';
        $('assets-recurring-to').value = item.toAccountId ?? 'cash-savings';
        $('assets-recurring-frequency').value = item.frequency;
        $('assets-recurring-day').value = String(item.dayOfMonth ?? 27);
        $('assets-recurring-month').value = String(item.monthOfYear ?? 1);
        $('assets-recurring-weekday').value = String(item.weekday ?? 1);
        $('assets-recurring-start').value = item.startOn;
        $('assets-recurring-end').value = item.endOn ?? '';
        $('assets-recurring-category').value = item.categoryId ?? '';
        $('assets-recurring-enabled').checked = item.enabled;
        $('assets-recurring-form-title').textContent = `「${item.name}」を編集`;
        $('assets-recurring-save').textContent = '保存';
        updateFormFields();
        $('assets-recurring-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    async function saveSnapshots() {
        if (busy)
            return;
        const node = $('assets-balances-status');
        const entered = ASSET_ACCOUNTS.filter(account => amounts.get(account.id).value.trim() !== '');
        if (!entered.length) {
            status(node, '保存する口座の残高を入力してください。', true);
            return;
        }
        const pending = [];
        try {
            // All accounts in one save share the click-time confirmation timestamp.
            const confirmationTime = new Date().toISOString(); /* finance-v145 */
            for (const account of entered) {
                const amount = amounts.get(account.id);
                const snapshot = validateSnapshot({ id: crypto.randomUUID(), accountId: account.id, balance: Number(amount.value), observedAt: confirmationTime });
                pending.push({ accountId: account.id, amount: amount.value, snapshot });
            }
            toggleBusy(true);
            status(node, `${pending.length}口座の残高を保存中…`);
            await requireVault().addBalanceSnapshots(pending.map(item => item.snapshot));
            for (const item of pending) {
                const amount = amounts.get(item.accountId);
                if (amount.value === item.amount)
                    amount.value = '';
            }
            status(node, `${pending.length}口座の残高を保存しました。`);
            onSaved(`${pending.length}口座の残高を保存しました。`);
            render();
        }
        catch (error) {
            status(node, `保存できませんでした：${error instanceof Error ? error.message : '不明なエラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    async function deleteSnapshot(id, accountId) {
        if (busy || !window.confirm('この残高記録を削除しますか？ 最新残高の基準が変わる場合があります。'))
            return;
        const node = $('assets-balances-status');
        toggleBusy(true);
        status(node, `${accountName(accountId)}の残高記録を削除しています…`);
        try {
            await requireVault().deleteBalanceSnapshot(id);
            status(node, `${accountName(accountId)}の残高記録を削除しました。`);
            onSaved('残高記録をOneDriveから削除しました。');
            render();
        }
        catch (error) {
            status(node, `削除失敗：${error instanceof Error ? error.message : '不明なエラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    const onceKinds = { expense: '支出', income: '入金', transfer: '振替', withdrawal: '現金引出' };
    const onceDialog = $('assets-once-dialog');
    let previousBodyPosition = '';
    let previousBodyTop = '';
    let previousBodyWidth = '';
    let previousBodyOverflow = '';
    let modalScrollY = 0;
    function lockOncePage() {
        // Fixed-body scroll lock also works in iOS Safari while the dialog itself scrolls.
        if (document.documentElement.classList.contains('assets-once-page-locked'))
            return;
        modalScrollY = window.scrollY;
        previousBodyPosition = document.body.style.position;
        previousBodyTop = document.body.style.top;
        previousBodyWidth = document.body.style.width;
        previousBodyOverflow = document.body.style.overflow;
        document.documentElement.classList.add('assets-once-page-locked');
        document.body.style.position = 'fixed';
        document.body.style.top = `-${modalScrollY}px`;
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
    }
    function unlockOncePage() {
        if (!document.documentElement.classList.contains('assets-once-page-locked'))
            return;
        document.documentElement.classList.remove('assets-once-page-locked');
        document.body.style.position = previousBodyPosition;
        document.body.style.top = previousBodyTop;
        document.body.style.width = previousBodyWidth;
        document.body.style.overflow = previousBodyOverflow;
        window.scrollTo(0, modalScrollY);
    }
    onceDialog.addEventListener('close', unlockOncePage);
    const onceKind = () => (document.querySelector('input[name="assets-once-kind"]:checked')?.value ?? 'transfer');
    const onceStatus = () => (document.querySelector('input[name="assets-once-status"]:checked')?.value ?? 'done');
    function onceFormFields() {
        const kind = onceKind(), from = value('assets-once-from'), to = value('assets-once-to');
        $('assets-once-from-wrap').classList.toggle('hidden', kind === 'income');
        $('assets-once-to-wrap').classList.toggle('hidden', kind === 'expense' || kind === 'withdrawal');
        const label = $('assets-once-to-wrap');
        if (kind === 'income')
            label.firstChild.textContent = '入金先口座';
        else
            label.firstChild.textContent = '振替先口座';
        const funding = kind === 'transfer' && from === 'rakuten-bank' && to === 'mizuho-bank';
        $('assets-once-funding-wrap').classList.toggle('hidden', !funding);
        if (!funding)
            $('assets-once-funding').checked = false;
    }
    function resetOnceForm() {
        onceEditingId = null;
        onceDirty = false;
        $('assets-once-form').reset();
        $('assets-once-date').value = localDate();
        $('assets-once-from').value = 'rakuten-bank';
        $('assets-once-to').value = 'cash-savings';
        $('assets-once-funding').checked = false;
        $('assets-once-dialog-title').textContent = '入出金を登録';
        $('assets-once-save').textContent = '保存';
        status($('assets-once-error'), '');
        onceFormFields();
    }
    function openOnce(entry) {
        if (busy || !getVault()?.unlocked)
            return;
        resetOnceForm();
        if (entry) {
            onceEditingId = entry.id;
            $('assets-once-date').value = entry.date;
            $('assets-once-name').value = entry.name;
            $('assets-once-amount').value = String(entry.amount);
            $('assets-once-from').value = entry.fromAccountId ?? 'rakuten-bank';
            $('assets-once-to').value = entry.toAccountId ?? 'cash-savings';
            $('assets-once-funding').checked = !!entry.cardFunding;
            $('assets-once-form').querySelector(`input[name="assets-once-kind"][value="${entry.kind}"]`).checked = true;
            $('assets-once-form').querySelector(`input[name="assets-once-status"][value="${entry.status}"]`).checked = true;
            $('assets-once-dialog-title').textContent = '入出金を編集';
            $('assets-once-save').textContent = '保存';
            onceFormFields();
            onceDirty = false;
        }
        onceDialog.showModal();
        lockOncePage();
    }
    function closeOnce() { if (busy)
        return; onceDialog.close(); resetOnceForm(); }
    function readOnce() {
        const kind = onceKind(), from = value('assets-once-from'), to = value('assets-once-to');
        return validateOneTime({ id: onceEditingId ?? crypto.randomUUID(), date: value('assets-once-date'),
            name: value('assets-once-name'), amount: Number(value('assets-once-amount')), kind, status: onceStatus(),
            fromAccountId: kind === 'income' ? null : from, toAccountId: kind === 'transfer' || kind === 'income' ? to : null,
            ...(kind === 'transfer' && from === 'rakuten-bank' && to === 'mizuho-bank' && $('assets-once-funding').checked ? { cardFunding: true } : {}) });
    }
    function renderOnce() {
        const data = getVault()?.unlocked ? getVault().assetSettings() : null;
        const list = $('assets-once-list');
        list.replaceChildren();
        if (!data)
            return;
        const entries = [...(data.oneTime ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
        $('assets-once-count').textContent = `${entries.length}件`;
        if (!entries.length)
            list.append(make('p', 'assets-once-empty', 'まだ入出金の記録はありません。'));
        for (const entry of (onceShowAll ? entries : entries.slice(0, 6))) {
            const row = make('div', 'assets-once-item'), detail = make('div', 'assets-once-item-detail');
            detail.append(make('strong', '', entry.name));
            const from = accountName(entry.fromAccountId), to = accountName(entry.toAccountId);
            const route = entry.kind === 'transfer' ? `${from} → ${to}` : entry.kind === 'income' ? to : from;
            detail.append(make('small', '', `${entry.date.replace(/-/g, '/')} · ${onceKinds[entry.kind]} · ${route} · ${entry.status === 'done' ? '実行済み' : '予定'}`));
            const right = make('div', 'assets-once-item-action');
            right.append(make('b', '', `${entry.kind === 'income' ? '+' : entry.kind === 'expense' || entry.kind === 'withdrawal' ? '−' : ''}${yen(entry.amount)}`), addButton('編集', () => openOnce(entry)), addButton('削除', () => { void deleteOnce(entry.id); }, true));
            row.append(detail, right);
            list.append(row);
        }
        const more = $('assets-once-toggle');
        more.classList.toggle('hidden', entries.length <= 6);
        more.textContent = onceShowAll ? '閉じる' : `すべて表示（${entries.length}件）`;
    }
    async function saveOnce() {
        if (busy)
            return;
        const node = $('assets-once-error');
        try {
            const entry = readOnce();
            toggleBusy(true);
            await requireVault().upsertOneTime(entry);
            onceDirty = false;
            onceDialog.close();
            resetOnceForm();
            status($('assets-once-status'), '入出金を保存しました。');
            onSaved('入出金をOneDriveに保存しました。');
            render();
            onPayrollChange();
        }
        catch (error) {
            status(node, `保存できませんでした：${error instanceof Error ? error.message : '通信エラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    async function deleteOnce(id) {
        if (busy || !window.confirm('この入出金記録を削除しますか？'))
            return;
        toggleBusy(true);
        try {
            await requireVault().deleteOneTime(id);
            status($('assets-once-status'), '入出金を削除しました。');
            onSaved('入出金記録を削除しました。');
            render();
            onPayrollChange();
        }
        catch (error) {
            status($('assets-once-status'), `削除できませんでした：${error instanceof Error ? error.message : '通信エラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    function renderAccounts() {
        const vault = getVault();
        if (!vault?.unlocked)
            return;
        const data = vault.assetSettings(), records = vault.records();
        const today = new Date();
        const available = payrollSynced ? payrollIncome : [];
        const currentReport = forecastBankBalances(data, localDay(today), records, available, data.payrollDepositAccount, localDay(today)), nextReport = forecastBankBalances(data, lastDayOfNextMonth(today), records, available, data.payrollDepositAccount, localDay(today));
        const now = currentReport.accounts, next = nextReport.accounts;
        for (const account of ASSET_ACCOUNTS) {
            const latest = latestBalance(data, account.id), current = now[account.id], upcoming = next[account.id];
            const label = latestTexts.get(account.id);
            label.replaceChildren();
            label.append(make('small', 'assets-balance-caption', '現在の推定残高'), make('strong', 'assets-balance', current.balance !== null ? yen(current.balance) : '未登録'));
            if (latest) {
                label.append(make('small', 'assets-balance-date', `最終確認：${yen(latest.balance)}（${new Date(latest.observedAt).toLocaleString('ja-JP')}）`));
                const parts = [];
                if (current.recurringDelta)
                    parts.push(`定期入出金 ${current.recurringDelta > 0 ? '+' : ''}${yen(current.recurringDelta)}`);
                if (current.oneTimeDelta)
                    parts.push(`単発入出金 ${current.oneTimeDelta > 0 ? '+' : ''}${yen(current.oneTimeDelta)}`);
                if (current.cardNisaDelta)
                    parts.push(`カード積立 +${yen(current.cardNisaDelta)}`);
                if (current.payrollDelta)
                    parts.push(`Payroll給与 +${yen(current.payrollDelta)}`);
                const cardDebits = currentReport.cardDebitByAccount[account.id] ?? 0;
                if (cardDebits)
                    parts.push(`カード引落 −${yen(cardDebits)}`);
                const autoTransfer = currentReport.autoTransferByAccount[account.id] ?? 0;
                if (autoTransfer)
                    parts.push(`みずほ送金予測 ${autoTransfer > 0 ? '+' : ''}${yen(autoTransfer)}`);
                // Shared detail panel below all three accounts, not uneven paragraphs in each card.
                label.append(make('div', 'assets-balance-future', `来月末の予測：${upcoming.balance === null ? '未取得' : yen(upcoming.balance)}`));
                const details = accountDetails.get(account.id);
                details.replaceChildren();
                if (parts.length)
                    details.append(make('p', '', parts.join(' / ')));
                if (current.warning)
                    details.append(make('p', '', current.warning));
                if (data.payrollDepositAccount === account.id && !payrollSynced)
                    details.append(make('p', '', 'Payrollの給与は未取得です。'));
                const expected = nextReport.estimatedByAccount[account.id] ?? 0;
                if (expected)
                    details.append(make('p', '', `給与見込み +${yen(expected)}`));
                if (account.id === 'rakuten-bank' && !data.payrollDepositAccount)
                    details.append(make('p', '', '給与の振込先は「設定」で登録できます。'));
                if (!details.childElementCount)
                    details.append(make('p', '', '入出金の変動なし'));
            }
            else
                label.append(make('small', 'assets-balance-date', 'まず残高を登録してください。'));
            const history = histories.get(account.id);
            history.replaceChildren();
            const items = data.snapshots.filter(x => x.accountId === account.id).sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id));
            for (const item of items.slice(0, 12)) {
                const row = make('div', 'assets-history-row');
                const copy = make('span', '', `${new Date(item.observedAt).toLocaleString('ja-JP')}　${yen(item.balance)}`);
                row.append(copy, addButton('削除', () => { void deleteSnapshot(item.id, account.id); }, true));
                history.append(row);
            }
            if (!items.length)
                history.append(make('p', 'assets-help', 'まだ残高履歴はありません。'));
            if (items.length > 12)
                history.append(make('p', 'assets-help', `直近12件を表示（全${items.length}件）`));
            const count = document.getElementById(`assets-history-count-${account.id}`);
            if (count)
                count.textContent = `（${items.length}件）`;
        }
    }
    function renderCardDebitAccounts() {
        const vault = getVault();
        if (!vault?.unlocked)
            return;
        const container = $('assets-card-debits-list');
        const saved = vault.assetSettings().cardDebitAccounts ?? {};
        const selected = new Map();
        if (cardDebitAccountsDirty)
            for (const field of container.querySelectorAll('input[type="radio"]:checked'))
                selected.set(field.dataset.cardId, field.value);
        container.replaceChildren();
        for (const card of CARDS) {
            const box = make('fieldset', 'assets-card-debits-item');
            box.append(make('legend', '', card.name));
            const radioGroup = make('div', 'assets-debit-radio-row');
            const value = selected.get(card.id) ?? saved[card.id] ?? '';
            for (const [id, title] of [['', '未設定'], ['rakuten-bank', '楽天'], ['mizuho-bank', 'みずほ'], ['cash-savings', '貯金口座']]) {
                const label = make('label', 'assets-debit-radio');
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = `card-debit-${card.id}`;
                input.dataset.cardId = card.id;
                input.value = id;
                input.checked = id === value;
                input.addEventListener('change', () => { cardDebitAccountsDirty = true; });
                label.append(input, document.createTextNode(title));
                radioGroup.append(label);
            }
            box.append(radioGroup);
            container.append(box);
        }
    }
    async function saveCardDebitAccounts() {
        if (busy)
            return;
        const values = {};
        for (const field of $('assets-card-debits-list').querySelectorAll('input[type="radio"]:checked')) {
            if (['rakuten-bank', 'mizuho-bank', 'cash-savings'].includes(field.value))
                values[field.dataset.cardId] = field.value;
        }
        if (requireVault().assetSettings().mizuhoTransferPlan?.enabled && values['rakuten-mizuho'] !== 'mizuho-bank') {
            status($('assets-card-debits-status'), '送金予測が有効です。みずほ楽天カードは「みずほ」を選んでください。', true);
            return;
        }
        const node = $('assets-card-debits-status');
        toggleBusy(true);
        status(node, '保存中…');
        try {
            await requireVault().setCardDebitAccounts(values);
            cardDebitAccountsDirty = false;
            status(node, '保存しました。');
            onSaved('カードの引落口座を保存しました。');
            render();
        }
        catch (err) {
            status(node, `保存失敗：${err instanceof Error ? err.message : '通信エラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    function renderMizuhoPlan() {
        const vault = getVault();
        if (!vault?.unlocked)
            return;
        const plan = vault.assetSettings().mizuhoTransferPlan ?? DEFAULT_MIZUHO_PLAN;
        $('mizuho-plan-enabled').checked = plan.enabled;
        $('mizuho-plan-lead').value = String(plan.leadDays);
        $('mizuho-plan-extra').checked = plan.extraForSmallBills;
        const update = () => {
            const extra = $('mizuho-plan-extra').checked;
            $('mizuho-plan-example').textContent = `例：24,245円 → ${yen(estimateMizuhoTransferAmount(24245, extra))}、160,500円 → ${yen(estimateMizuhoTransferAmount(160500, extra))}（請求額から自動試算）`;
        };
        update();
    }
    async function saveMizuhoPlan() {
        if (busy)
            return;
        const plan = { enabled: $('mizuho-plan-enabled').checked, leadDays: Number(value('mizuho-plan-lead')), extraForSmallBills: $('mizuho-plan-extra').checked };
        const node = $('mizuho-plan-status');
        toggleBusy(true);
        status(node, '保存中…');
        try {
            await requireVault().setMizuhoTransferPlan(plan);
            cardDebitAccountsDirty = false;
            status(node, '保存しました。');
            onSaved('みずほへの送金予測を保存しました。');
            render();
        }
        catch (err) {
            status(node, `保存失敗：${err instanceof Error ? err.message : '入力を確認してください。'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    function renderNisaLink() {
        const vault = getVault();
        if (!vault?.unlocked)
            return;
        const rule = vault.assetSettings().nisaCardRule;
        if (!nisaDirty) {
            $('assets-nisa-card').value = rule?.cardId ?? CARDS[0].id;
            $('assets-nisa-merchant').value = rule?.merchantContains ?? '';
        }
        const matches = matchingNisaRows(vault.assetSettings(), vault.records());
        $('assets-nisa-match-count').textContent = rule?.enabled ? `保存済みの該当明細：${matches.length}件` : '未連携';
        $('assets-nisa-disable').disabled = busy || !rule;
    }
    async function updateNisaLink(clear = false) {
        if (busy)
            return;
        const node = $('assets-nisa-status');
        try {
            const cardId = value('assets-nisa-card'), merchant = value('assets-nisa-merchant').trim();
            const link = clear ? null : validateNisaCardRule({ cardId, merchantContains: merchant, enabled: true });
            // Invalid or empty matching text must not silently match every card row.
            if (!clear && !CARDS.some(c => c.id === cardId))
                throw new Error('対象カードを選択してください。');
            toggleBusy(true);
            status(node, '連携条件をOneDriveに保存しています…');
            await requireVault().setNisaCardRule(link);
            nisaDirty = false;
            status(node, clear ? 'NISAのカード連携を解除しました。' : 'NISAのカード連携を保存しました。');
            onSaved(clear ? 'NISAカード連携を解除しました。' : 'NISAカード連携を保存しました。');
            render();
        }
        catch (error) {
            status(node, `保存できませんでした：${error instanceof Error ? error.message : '不明なエラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    function renderRecurring() {
        const vault = getVault();
        if (!vault?.unlocked)
            return;
        const entries = [...vault.assetSettings().recurring].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        $('assets-recurring-count').textContent = `${entries.length}件`;
        const list = $('assets-recurring-list');
        list.replaceChildren();
        if (!entries.length) {
            list.append(make('p', 'assets-empty', '定期入出金はまだありません。左のフォームから登録できます。'));
            return;
        }
        for (const item of entries) {
            const card = make('div', `assets-recurring-item${item.enabled ? '' : ' is-disabled'}`);
            const top = make('div', 'assets-recurring-top');
            const title = make('strong', '', item.name), sum = make('b', '', `${item.kind === 'expense' ? '−' : item.kind === 'income' ? '+' : '⇄'} ${yen(item.amount)}`);
            top.append(title, sum);
            const path = item.kind === 'expense' ? `${accountName(item.fromAccountId)}から引落` :
                item.kind === 'income' ? `${accountName(item.toAccountId)}へ入金` : `${accountName(item.fromAccountId)} → ${accountName(item.toAccountId)}`;
            const category = item.categoryId ? getCategories().find(c => c.id === item.categoryId)?.name : '';
            const tags = make('div', 'assets-recurring-tags');
            tags.append(make('span', 'assets-recurring-tag', kindName[item.kind]), make('span', 'assets-recurring-tag', frequencyLabel(item)));
            if (category)
                tags.append(make('span', 'assets-recurring-tag', category));
            if (!item.enabled)
                tags.append(make('span', 'assets-recurring-tag is-paused', '停止中'));
            const route = make('p', 'assets-recurring-route', path);
            const dates = make('p', 'assets-recurring-dates', `${item.startOn.replace(/-/g, '/')} ～ ${item.endOn?.replace(/-/g, '/') ?? '無期限'}`);
            const actions = make('div', 'assets-recurring-actions');
            actions.append(addButton('編集', () => populateForm(item)), addButton('削除', () => { void removeRecurring(item); }, true));
            card.append(top, tags, route, dates, actions);
            list.append(card);
        }
    }
    async function removeRecurring(item) {
        if (busy || !window.confirm(`「${item.name}」を削除しますか？`))
            return;
        const node = $('assets-recurring-status');
        toggleBusy(true);
        status(node, 'OneDriveから削除しています…');
        try {
            await requireVault().deleteRecurring(item.id);
            if (editingId === item.id)
                resetForm();
            status(node, '削除しました。');
            onSaved('定期入出金をOneDriveから削除しました。');
            render();
        }
        catch (error) {
            status(node, `削除失敗：${error instanceof Error ? error.message : '不明なエラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    function renderPayroll() {
        const vault = getVault();
        if (!vault?.unlocked)
            return;
        if (!payrollAccountDirty)
            $('assets-payroll-deposit').value = vault.assetSettings().payrollDepositAccount ?? '';
        const enabled = !!vault.assetSettings().payrollAutoPassphrase;
        $('assets-payroll-auto-status').textContent = enabled
            ? '自動取得：オン'
            : '自動取得：オフ';
        const months = $('assets-payroll-months');
        if (!payrollSynced) {
            $('assets-payroll-count').textContent = '';
            $('assets-payroll-last').textContent = '';
            months.replaceChildren();
            return;
        }
        $('assets-payroll-count').textContent = `${payrollIncome.length}件`;
        $('assets-payroll-last').textContent = new Date(payrollSyncedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        months.replaceChildren();
        for (const [month, amounts] of [...incomeByMonth(payrollIncome)].sort((a, b) => b[0].localeCompare(a[0]))) {
            const row = make('div', 'assets-payroll-month');
            row.append(make('span', '', month.replace('-', '年') + '月'), make('small', '', `${amounts.count}件`));
            months.append(row);
        }
        const recurring = vault.assetSettings().recurring.filter(e => e.enabled && e.kind === 'income' && /給与|給料|salary|payroll/i.test(e.name));
        if (recurring.length)
            status($('assets-payroll-status'), `給与を${payrollIncome.length}件読み込みました。注意：給与らしい定期入金が${recurring.length}件登録されています。二重計上にご注意ください。`);
    }
    /** Manual registration is explicit; automatic reads use only the encrypted settings document. */
    async function syncPayroll(automatic = false) {
        if (busy || payrollBusy)
            return;
        const vault = getVault();
        if (!vault?.unlocked) {
            status($('assets-payroll-status'), 'Financeの保管庫を解除してから連携してください。', true);
            return;
        }
        const pass = $('assets-payroll-secret');
        const entered = automatic ? '' : pass.value;
        pass.value = '';
        const saved = vault.assetSettings().payrollAutoPassphrase;
        const secret = entered || ((payrollSession && payrollOwner === vault) ? '' : saved ?? '');
        const keepAuto = $('assets-payroll-remember').checked;
        if (!automatic && keepAuto && !saved && !entered) {
            status($('assets-payroll-status'), '自動連携の初回登録にはPayrollのパスフレーズを入力してください。', true);
            return;
        }
        payrollBusy = true;
        lastPayrollAttemptAt = Date.now();
        $('assets-payroll-sync').disabled = true;
        $('assets-payroll-forget').disabled = true;
        try {
            const session = secret ? await PayrollReadSession.connect(vault.payrollReadClient(), secret) : payrollSession;
            if (!session || (!secret && payrollOwner !== vault))
                throw new Error('Payrollのパスフレーズを入力してください。');
            status($('assets-payroll-status'), automatic ? 'Payrollの収入を自動同期しています…' : 'Payrollの暗号化収入を取得・検証しています…');
            const items = await session.refresh();
            if (!vault.unlocked || getVault() !== vault)
                throw new Error('保管庫が変更されました。再同期してください。');
            if (!automatic && (entered || saved !== null)) {
                // Only persist on an explicitly submitted form after verifying the password.
                // This value lives only in encrypted finance/settings/assets.enc, never localStorage.
                if (keepAuto)
                    await vault.setPayrollAutoPassphrase(entered);
                else if (saved !== null)
                    await vault.setPayrollAutoPassphrase(null);
            }
            payrollSession = session;
            payrollOwner = vault;
            payrollIncome = items;
            payrollSynced = true;
            payrollSyncedAt = Date.now();
            status($('assets-payroll-status'), `Payrollから${items.length}件の給与実績を${automatic ? '自動取得' : '取得'}しました。`);
            renderAccounts();
            renderPayroll();
            onPayrollChange();
        }
        catch (error) {
            // In case of a revoked password or interrupted download, never forecast from stale salaries.
            payrollSession = null;
            payrollOwner = null;
            payrollIncome = [];
            payrollSynced = false;
            status($('assets-payroll-status'), `給与を取得できませんでした：${error instanceof Error ? error.message : '通信エラー'}。設定から再接続できます。`, true);
            if (getVault()?.unlocked) {
                renderAccounts();
                renderPayroll();
            }
            onPayrollChange();
        }
        finally {
            payrollBusy = false;
            $('assets-payroll-sync').disabled = false;
            $('assets-payroll-forget').disabled = !getVault()?.unlocked;
        }
    }
    async function refreshPayroll() {
        const vault = getVault();
        if (!vault?.unlocked || payrollBusy || busy)
            return;
        const sameVault = payrollOwner === vault && payrollSession && payrollSynced;
        if (sameVault) {
            if (Date.now() - payrollSyncedAt >= 10 * 60 * 1000)
                await syncPayroll(true);
            return;
        }
        if (!vault.assetSettings().payrollAutoPassphrase)
            return;
        // If the cloud is temporarily unavailable, do not spam Graph on every UI render.
        if (Date.now() - lastPayrollAttemptAt < 60 * 1000)
            return;
        await syncPayroll(true);
    }
    async function forgetPayroll() {
        if (busy || payrollBusy)
            return;
        if (!getVault()?.unlocked)
            return;
        if (!window.confirm('Payrollの自動連携を解除しますか？保存済みの連携パスフレーズと、このタブの給与情報を破棄します。給与の原本は変更しません。'))
            return;
        payrollBusy = true;
        $('assets-payroll-forget').disabled = true;
        try {
            await requireVault().setPayrollAutoPassphrase(null);
            payrollSession = null;
            payrollIncome = [];
            payrollSynced = false;
            payrollOwner = null;
            payrollSyncedAt = 0;
            $('assets-payroll-secret').value = '';
            status($('assets-payroll-status'), '自動連携を解除し、Financeの暗号化設定から連携パスフレーズを削除しました。');
            renderAccounts();
            renderPayroll();
            onPayrollChange();
        }
        catch (error) {
            status($('assets-payroll-status'), `連携解除の保存に失敗しました：${error instanceof Error ? error.message : '通信エラー'}`, true);
        }
        finally {
            payrollBusy = false;
            $('assets-payroll-forget').disabled = false;
        }
    }
    async function savePayrollDeposit() {
        if (busy || payrollBusy)
            return;
        if (!getVault()?.unlocked) {
            status($('assets-payroll-status'), 'Financeの保管庫を解除してください。', true);
            return;
        }
        const id = value('assets-payroll-deposit');
        if (!['', 'rakuten-bank', 'cash-savings'].includes(id))
            throw new Error('給与の振込先が不正です。');
        const node = $('assets-payroll-status');
        toggleBusy(true);
        status(node, '給与の入金先設定をOneDriveに保存しています…');
        try {
            await requireVault().setPayrollDepositAccount(id === '' ? null : id);
            payrollAccountDirty = false;
            status(node, '給与の入金先を暗号化して保存しました。');
            onSaved('給与の入金先を保存しました。');
            render();
        }
        catch (error) {
            status(node, `保存失敗：${error instanceof Error ? error.message : '通信エラー'}`, true);
        }
        finally {
            toggleBusy(false);
        }
    }
    function render() {
        const unlocked = !!getVault()?.unlocked;
        for (const element of document.querySelectorAll('#assets-payroll-connect input, #assets-payroll-connect button, #assets-payroll-deposit-form select, #assets-payroll-deposit-form button'))
            element.disabled = !unlocked;
        $('assets-lock-message').classList.toggle('hidden', unlocked);
        $('assets-workspace').classList.toggle('hidden', !unlocked);
        if (!unlocked)
            return;
        const cat = $('assets-recurring-category');
        const selected = cat.value;
        choices(cat, [{ value: '', label: '分類しない' }, ...getCategories().map(c => ({ value: c.id, label: c.name }))]);
        cat.value = selected;
        renderAccounts();
        renderOnce();
        renderNisaLink();
        renderCardDebitAccounts();
        renderMizuhoPlan();
        renderPayroll();
        renderRecurring();
    }
    // Group the everyday bank account separately from the two savings assets.
    for (const account of ASSET_ACCOUNTS) {
        const article = make('section', 'panel assets-account-card');
        article.setAttribute('aria-label', `${account.name}の残高設定`);
        const header = make('div', 'assets-account-heading'), icon = make('div', 'assets-account-icon', account.icon), title = make('div');
        title.append(make('h3', '', account.name), make('p', '', account.detail));
        header.append(icon, title);
        const balance = make('div', 'assets-latest');
        latestTexts.set(account.id, balance);
        const fields = make('div', 'assets-balance-form');
        const amountLabel = make('label', 'rules-field', '確認した残高（円）');
        const amount = document.createElement('input');
        amount.type = 'number';
        amount.min = '0';
        amount.step = '1';
        amount.inputMode = 'numeric';
        amount.placeholder = '金額を入力';
        amount.setAttribute('aria-label', `${account.name}の残高`);
        amountLabel.append(amount);
        amounts.set(account.id, amount);
        fields.append(amountLabel);
        const historyDetails = document.createElement('details');
        historyDetails.className = 'assets-history';
        const sum = make('summary', 'assets-history-summary');
        sum.append(make('span', 'assets-history-caption', '残高の記録履歴'));
        const count = make('span', 'assets-history-counter', '（0件）');
        count.id = `assets-history-count-${account.id}`;
        sum.append(count);
        historyDetails.append(sum);
        const history = make('div', 'assets-history-content');
        historyDetails.append(history);
        histories.set(account.id, history);
        article.append(header, balance, fields, historyDetails);
        $(account.id === 'rakuten-bank' || account.id === 'mizuho-bank' ? 'assets-account-main' : 'assets-account-savings').append(article);
        const info = $('assets-account-info');
        const detailRow = make('div', 'assets-info-row');
        const heading = make('strong', '', account.name);
        const detail = make('div', 'assets-info-text');
        accountDetails.set(account.id, detail);
        detailRow.append(heading, detail);
        info.append(detailRow);
    }
    choices($('assets-once-from'), ASSET_ACCOUNTS.map(x => ({ value: x.id, label: x.name })));
    choices($('assets-once-to'), ASSET_ACCOUNTS.map(x => ({ value: x.id, label: x.name })));
    resetOnceForm();
    $('assets-once-add').addEventListener('click', () => openOnce());
    $('assets-once-toggle').addEventListener('click', () => { onceShowAll = !onceShowAll; renderOnce(); });
    $('assets-once-close').addEventListener('click', closeOnce);
    $('assets-once-cancel').addEventListener('click', closeOnce);
    onceDialog.addEventListener('cancel', event => { event.preventDefault(); closeOnce(); });
    $('assets-once-form').addEventListener('input', () => { onceDirty = true; });
    $('assets-once-form').addEventListener('change', () => { onceDirty = true; onceFormFields(); });
    $('assets-once-form').addEventListener('submit', event => { event.preventDefault(); void saveOnce(); });
    $('assets-balances-form').addEventListener('submit', event => { event.preventDefault(); void saveSnapshots(); });
    choices($('assets-nisa-card'), CARDS.map(c => ({ value: c.id, label: c.name })));
    $('assets-nisa-link-form').addEventListener('input', () => { nisaDirty = true; });
    $('assets-nisa-link-form').addEventListener('change', () => { nisaDirty = true; });
    $('assets-nisa-link-form').addEventListener('submit', event => { event.preventDefault(); void updateNisaLink(); });
    $('assets-nisa-disable').addEventListener('click', () => { void updateNisaLink(true); });
    $('assets-card-debits-form').addEventListener('submit', event => { event.preventDefault(); void saveCardDebitAccounts(); });
    $('mizuho-plan-form').addEventListener('submit', event => { event.preventDefault(); void saveMizuhoPlan(); });
    $('mizuho-plan-extra').addEventListener('change', () => { $('mizuho-plan-example').textContent = `例：24,245円 → ${yen(estimateMizuhoTransferAmount(24245, $('mizuho-plan-extra').checked))}、160,500円 → ${yen(estimateMizuhoTransferAmount(160500, $('mizuho-plan-extra').checked))}`; });
    $('assets-payroll-connect').addEventListener('submit', event => { event.preventDefault(); void syncPayroll(); });
    $('assets-payroll-deposit-form').addEventListener('submit', event => { event.preventDefault(); void savePayrollDeposit(); });
    $('assets-payroll-deposit').addEventListener('change', () => { payrollAccountDirty = true; });
    $('assets-payroll-forget').addEventListener('click', () => { void forgetPayroll(); });
    choices($('assets-recurring-from'), ASSET_ACCOUNTS.map(x => ({ value: x.id, label: x.name })));
    choices($('assets-recurring-to'), ASSET_ACCOUNTS.map(x => ({ value: x.id, label: x.name })));
    choices($('assets-recurring-day'), [{ value: '0', label: '末日' }, ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}日` }))]);
    choices($('assets-recurring-month'), Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` })));
    choices($('assets-recurring-weekday'), weekdayLabels.map((label, i) => ({ value: String(i), label: `${label}曜日` })));
    $('assets-recurring-form').addEventListener('input', markDirty);
    $('assets-recurring-form').addEventListener('change', markDirty);
    $('assets-recurring-kind').addEventListener('change', updateFormFields);
    $('assets-recurring-frequency').addEventListener('change', updateFormFields);
    $('assets-recurring-clear').addEventListener('click', () => { resetForm(); status($('assets-recurring-status'), '入力をクリアしました。'); });
    $('assets-recurring-form').addEventListener('submit', event => {
        event.preventDefault();
        if (busy)
            return;
        void (async () => {
            const node = $('assets-recurring-status');
            try {
                const entry = readEntry();
                toggleBusy(true);
                status(node, 'OneDriveに暗号化保存しています…');
                await requireVault().upsertRecurring(entry);
                resetForm();
                status(node, 'OneDriveへの保存が完了しました。');
                onSaved('定期入出金をOneDriveに保存しました。');
                render();
            }
            catch (error) {
                status(node, `保存できませんでした：${error instanceof Error ? error.message : '不明なエラー'}`, true);
            }
            finally {
                toggleBusy(false);
            }
        })();
    });
    resetForm();
    // Refresh the read-only calculation when the calendar day changes, even when
    // the page stays open across midnight. Never refresh or write OneDrive here.
    let lastProjectionDay = localDay(new Date());
    const refreshForNewDay = () => {
        const next = localDay(new Date());
        if (next === lastProjectionDay)
            return;
        lastProjectionDay = next;
        if (!$('assets-page').classList.contains('hidden') && getVault()?.unlocked)
            renderAccounts();
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden)
        refreshForNewDay(); });
    window.setInterval(refreshForNewDay, 120000);
    window.setInterval(() => { if (!document.hidden)
        void refreshPayroll(); }, 10 * 60 * 1000);
    return { render, refreshPayroll, payrollSnapshot: () => {
            const ready = !!getVault()?.unlocked && payrollSynced && payrollOwner === getVault();
            return ready ? { ready: true, syncedAt: payrollSyncedAt, entries: structuredClone(payrollIncome) } : { ready: false, syncedAt: null, entries: [] };
        }, reset: () => {
            resetForm();
            resetOnceForm();
            onceShowAll = false;
            nisaDirty = false;
            payrollAccountDirty = false;
            cardDebitAccountsDirty = false;
            payrollSession = null;
            payrollIncome = [];
            payrollSynced = false;
            payrollSyncedAt = 0;
            lastPayrollAttemptAt = 0;
            payrollOwner = null;
            $('assets-payroll-secret').value = '';
            $('assets-payroll-count').textContent = '';
            $('assets-payroll-last').textContent = '';
            $('assets-payroll-months').replaceChildren();
            status($('assets-payroll-status'), '');
            for (const account of ASSET_ACCOUNTS)
                amounts.get(account.id).value = '';
            status($('assets-balances-status'), '');
            status($('assets-recurring-status'), '');
            status($('assets-once-status'), '');
            render();
            onPayrollChange();
        }, isBusy: () => busy || payrollBusy, isDirty: () => onceDirty || dirty || nisaDirty || payrollAccountDirty || editing() || [...amounts.values()].some(input => input.value.trim() !== '') ||
            value('assets-recurring-name').trim() !== '' || value('assets-recurring-amount').trim() !== '' };
}
