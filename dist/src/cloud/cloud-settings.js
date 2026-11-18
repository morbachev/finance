import { createEncryptedProbe, decryptEncryptedProbe } from './test-envelope.js';
import { OneDriveTestClient } from './onedrive-api.js';
import { clearPasswordField } from '../ui/password-fields.js';
import { diagnoseVaultFiles } from './vault-diagnostics.js';
const CLIENT_KEY = 'finance-onedrive-public-client-id-v1';
const SCOPES = ['Files.ReadWrite.AppFolder'];
const $ = (id) => { const node = document.getElementById(id); if (!node)
    throw new Error(`Missing cloud element #${id}`); return node; };
const redirectUri = () => window.location.origin + window.location.pathname;
const validId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
let msal = null;
let initializing = null;
let activeId = '';
let busy = false;
let verified = false;
let reauthenticationRequired = false; /* finance-v146-noninteractive-check */
const account = () => msal?.getActiveAccount() ?? msal?.getAllAccounts()[0] ?? null;
let cloudStatusTimer; /* finance-settings-v144 */
function status(text, kind = 'neutral') {
    const el = $('cloud-status');
    if (cloudStatusTimer) {
        clearTimeout(cloudStatusTimer);
        cloudStatusTimer = undefined;
    }
    el.textContent = text;
    el.className = `cloud-status ${kind}${text ? '' : ' hidden'}`;
    if (text && kind !== 'error')
        cloudStatusTimer = setTimeout(() => {
            el.classList.add('hidden');
            cloudStatusTimer = undefined;
        }, 5000);
}
function updateUi() {
    const id = $('cloud-client-id').value.trim();
    const connected = !!account() && activeId === id;
    $('cloud-save-id').toggleAttribute('disabled', busy || !validId(id));
    $('cloud-login').toggleAttribute('disabled', busy || !validId(id) || (connected && !reauthenticationRequired));
    $('cloud-login').textContent = connected && reauthenticationRequired ? 'Microsoftアカウントを再接続' : 'Microsoftアカウントで接続';
    $('cloud-logout').toggleAttribute('disabled', busy || !connected);
    $('cloud-folder-check').toggleAttribute('disabled', busy || !connected);
    $('cloud-vault-diagnose').toggleAttribute('disabled', busy || !connected);
    $('cloud-diagnostic-copy').toggleAttribute('disabled', busy || !$('cloud-diagnostic-report').textContent?.trim());
    $('cloud-upload').toggleAttribute('disabled', busy || !connected);
    $('cloud-download').toggleAttribute('disabled', busy || !connected);
    $('cloud-account').textContent = connected ? (account()?.username || 'Microsoftアカウント') : '';
}
async function ensureMsal() {
    const id = $('cloud-client-id').value.trim();
    if (!validId(id))
        throw new Error('Microsoft Entraで取得したClient IDを設定してください。');
    if (msal && activeId === id)
        return msal;
    if (initializing)
        return initializing;
    initializing = (async () => {
        let lib;
        try {
            const url = new URL('../../vendor/msal/msal-browser.bundle.js', import.meta.url).href;
            lib = await import(url);
        }
        catch {
            throw new Error('認証ライブラリの読み込みに失敗しました。npm install → npm run build を確認してください。');
        }
        const instance = new lib.PublicClientApplication({
            auth: { clientId: id, authority: 'https://login.microsoftonline.com/consumers', redirectUri: redirectUri(), postLogoutRedirectUri: redirectUri(), navigateToLoginRequestUrl: false },
            cache: { cacheLocation: 'sessionStorage' },
        });
        await instance.initialize();
        const redirect = await instance.handleRedirectPromise();
        const active = redirect?.account ?? instance.getActiveAccount() ?? instance.getAllAccounts()[0];
        if (active)
            instance.setActiveAccount(active);
        msal = instance;
        activeId = id;
        verified = false;
        return instance;
    })();
    try {
        return await initializing;
    }
    finally {
        initializing = null;
    }
}
export async function graphClient() {
    const instance = await ensureMsal();
    const user = account();
    if (!user)
        throw new Error('まずOneDrive接続画面からMicrosoftアカウントにログインしてください。');
    try {
        return new OneDriveTestClient((await instance.acquireTokenSilent({ scopes: SCOPES, account: user })).accessToken);
    }
    catch {
        status('Microsoftアカウントの再認証が必要です。');
        if (!window.confirm('認証情報の更新が必要です。未保存の編集内容を確認してからMicrosoftログインへ移動してください。続行しますか？'))
            throw new Error('認証をキャンセルしました。');
        await instance.acquireTokenRedirect({ scopes: SCOPES, account: user });
        throw new Error('Microsoft認証画面へ移動しています。');
    }
}
/** This explicit check never opens a login screen or changes the account. */
async function graphClientWithoutRedirect() {
    const instance = await ensureMsal();
    const current = account();
    if (!current)
        throw new Error('Microsoftアカウントが未接続です。上の「接続」からログインしてください。');
    try {
        const token = await instance.acquireTokenSilent({ scopes: SCOPES, account: current });
        reauthenticationRequired = false;
        return new OneDriveTestClient(token.accessToken);
    }
    catch {
        reauthenticationRequired = true;
        updateUi();
        throw new Error('Microsoftアカウントの認証を確認できません。必要な場合は「Microsoftアカウントを再接続」を選択してください。');
    }
}
export function initCloudSettings(handlers) {
    let id = '';
    try {
        id = localStorage.getItem(CLIENT_KEY) ?? '';
    }
    catch { /* private browsing */ }
    $('cloud-client-id').value = id;
    // New installations show the only setup fields automatically; connected users see a tidy overview.
    if (!validId(id))
        $('cloud-advanced').open = true;
    $('cloud-redirect-uri').value = redirectUri();
    $('cloud-client-id').addEventListener('input', () => { verified = false; updateUi(); });
    async function action(fn) {
        if (busy)
            return;
        busy = true;
        updateUi();
        try {
            await fn();
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : '不明なエラー';
            status(reason, 'error');
        }
        finally {
            busy = false;
            updateUi();
        }
    }
    $('cloud-save-id').addEventListener('click', () => {
        void action(async () => {
            const value = $('cloud-client-id').value.trim();
            if (!validId(value))
                throw new Error('Client IDの形式が不正です。');
            if (account() && activeId !== value)
                throw new Error('先に現在のMicrosoftアカウントからサインアウトしてください。');
            localStorage.setItem(CLIENT_KEY, value);
            status('Client IDを保存しました。パスフレーズは保存していません。', 'ok');
        });
    });
    $('cloud-login').addEventListener('click', () => {
        void action(async () => {
            const value = $('cloud-client-id').value.trim();
            if (localStorage.getItem(CLIENT_KEY) !== value)
                throw new Error('先にClient IDを保存してください。');
            const instance = await ensureMsal();
            if (account()) {
                if (!reauthenticationRequired)
                    return;
                if (!window.confirm('Microsoftアカウントの認証画面を開いて再接続しますか？'))
                    return;
                await instance.acquireTokenRedirect({ scopes: SCOPES, account: account() });
                return;
            }
            if (!window.confirm('Microsoftログインへ移動します。未保存の編集がある場合は破棄されます。続行しますか？'))
                return;
            await instance.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
        });
    });
    $('cloud-logout').addEventListener('click', () => {
        void action(async () => {
            const user = account();
            if (!msal || !user)
                return;
            if (!window.confirm('Microsoftアカウントからサインアウトしますか？未保存の変更は失われます。'))
                return;
            if (!handlers.onLock())
                return;
            await msal.logoutRedirect({ account: user, postLogoutRedirectUri: redirectUri() });
        });
    });
    $('cloud-folder-check').addEventListener('click', () => {
        void action(async () => {
            const button = $('cloud-folder-check');
            button.textContent = '確認中…';
            let timer;
            try {
                // A GET to the app folder, not an upload and not a redirect to sign-in.
                const request = (async () => { await (await graphClientWithoutRedirect()).appFolderId(); })();
                await Promise.race([request, new Promise((_resolve, reject) => {
                        timer = setTimeout(() => reject(new Error('接続確認が時間内に完了しませんでした。ネットワークを確認してください。')), 15000);
                    })]);
                verified = true;
                status('保存先にアクセスできました。', 'ok');
            }
            finally {
                if (timer)
                    clearTimeout(timer);
                button.textContent = '保存先を確認';
            }
        });
    });
    $('cloud-vault-diagnose').addEventListener('click', () => {
        void action(async () => {
            const target = $('cloud-diagnostic-report');
            const password = $('cloud-diagnostic-secret').value;
            target.textContent = '診断中…';
            try {
                const result = await diagnoseVaultFiles(await graphClient(), password, message => { target.textContent = message; });
                target.textContent = result.report;
                status(result.ok ? '読み取り専用診断が完了しました。' : '診断で確認できないファイルが見つかりました。', 'neutral');
            }
            catch (error) {
                // A failed network/authorization operation is not a license to expose its raw response.
                target.textContent = '読み取り専用診断を完了できませんでした。\n認証・ネットワーク接続をご確認ください。';
                throw error;
            }
            finally {
                clearPasswordField('cloud-diagnostic-secret');
            }
        });
    });
    $('cloud-diagnostic-copy').addEventListener('click', () => {
        void action(async () => {
            const value = $('cloud-diagnostic-report').textContent ?? '';
            if (!value.trim())
                throw new Error('先に診断を実行してください。');
            await navigator.clipboard.writeText(value);
            status('診断結果をコピーしました。内容にパスフレーズ・暗号文・ファイルIDは含めていません。', 'ok');
        });
    });
    $('cloud-upload').addEventListener('click', () => {
        void action(async () => {
            const input = $('cloud-passphrase');
            if (input.value.length < 12)
                throw new Error('テスト用パスフレーズは12文字以上で入力してください。');
            const { encrypted, probe } = await createEncryptedProbe(input.value);
            if (!window.confirm('金融データを含まない暗号化テストファイルをOneDriveに保存します。続行しますか？'))
                return;
            await (await graphClient()).uploadEncryptedProbe(encrypted);
            $('cloud-probe-result').textContent = `アップロード成功：${probe.createdAt} / ID ${probe.nonce}`;
            status('暗号化テストデータをアップロードしました。', 'ok');
        });
    });
    $('cloud-download').addEventListener('click', () => {
        void action(async () => {
            const input = $('cloud-passphrase');
            const probe = await decryptEncryptedProbe(await (await graphClient()).downloadEncryptedProbe(), input.value);
            clearPasswordField('cloud-passphrase');
            $('cloud-probe-result').textContent = `復号成功：${probe.createdAt} / ID ${probe.nonce}`;
            status('OneDriveから暗号化ファイルを取得し、復号できました。', 'ok');
        });
    });
    $('cloud-rotate-form').addEventListener('submit', event => {
        event.preventDefault();
        void action(async () => {
            const current = $('cloud-current-secret').value;
            const next = $('cloud-next-secret').value;
            const confirm = $('cloud-next-confirm').value;
            const message = $('cloud-rotate-status');
            if (next.length < 12)
                throw new Error('新しいパスフレーズは12文字以上にしてください。');
            if (next !== confirm)
                throw new Error('確認用のパスフレーズが一致しません。');
            if (current === next)
                throw new Error('現在と異なるパスフレーズを指定してください。');
            if (!window.confirm('OneDrive内の明細・PDF原本・設定を再暗号化します。作業中は他の端末で操作しないでください。続行しますか？'))
                return;
            const button = $('cloud-rotate-submit');
            button.disabled = true;
            message.className = 'cloud-status';
            try {
                await handlers.onChangePassphrase(current, next, text => { message.textContent = text; });
                for (const id of ['cloud-current-secret', 'cloud-next-secret', 'cloud-next-confirm'])
                    clearPasswordField(id);
                message.textContent = '新しいパスフレーズへの変更が完了しました。別端末では新しいパスフレーズで解除してください。';
                message.className = 'cloud-status ok';
                // The passphrase form stays visible after successful changes. /* finance-v145 */
                status('暗号化パスフレーズを変更しました。', 'ok');
            }
            catch (error) {
                message.textContent = `変更失敗：${error instanceof Error ? error.message : '不明なエラー'}`;
                message.className = 'cloud-status error';
                throw error;
            }
            finally {
                for (const id of ['cloud-current-secret', 'cloud-next-secret', 'cloud-next-confirm'])
                    clearPasswordField(id);
                button.disabled = false;
            }
        });
    });
    $('cloud-live-refresh').addEventListener('click', () => { void action(async () => { await handlers.onRefresh(); status('OneDriveから最新データを読み込みました。', 'ok'); }); });
    $('cloud-live-migrate').addEventListener('click', () => { void action(handlers.onMigration); });
    $('cloud-live-lock').addEventListener('click', () => { if (!busy)
        handlers.onLock(); });
    updateUi();
    if (id && validId(id))
        void action(async () => {
            await ensureMsal();
            updateUi();
        });
}
