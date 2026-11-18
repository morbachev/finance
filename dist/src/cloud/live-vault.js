import { validateMizuhoPlan } from './assets.js';
import { GraphError } from './onedrive-api.js';
import { decryptDocument, decryptIndex, decryptOriginal, deriveCloudKey, encryptDocument, encryptIndex, encryptOriginal, encryptRules, decryptRules, freshSalt, parseEnvelope, parseIndexEnvelope } from './cloud-crypto.js';
import { emptyDocument, mergeDocuments, detectDocumentEditCollisions } from './merge.js';
import { emptyIndex, statementBucket, validateIndex } from './layout.js';
import { emptyAssets, mergeAssets, detectAssetsEditCollisions, describeAssetsEditCollisions, validateSnapshot, validateRecurring, validateOneTime, validateNisaCardRule, validatePayrollAutoPassphrase, validateBirthMonth, validateCardDebitAccounts } from './assets.js';
import { encryptAssets, decryptAssets } from './cloud-crypto.js';
import { emptyRules, mergeRules, detectRuleEditCollisions, validateRule, validateCategory, listCategories, PALETTE, CATEGORIES } from './merchant-rules.js';
const clone = (value) => structuredClone(value);
const isConflict = (error) => error instanceof GraphError && (error.status === 409 || error.status === 412);
/** A remote write may already have committed; never present this as a definite failure. */
export class CloudWriteUncertainError extends Error {
    reason;
    constructor(message, reason) {
        super(message);
        this.reason = reason;
        this.name = 'CloudWriteUncertainError';
    }
}
/** Cancelled / unapproved collision, not a transport failure. */
export class CloudEditCancelledError extends Error {
    constructor(message) { super(message); this.name = 'CloudEditCancelledError'; }
}
export class LiveVault {
    client;
    key = null;
    salt = '';
    dataSetId = null;
    rotating = false;
    index = emptyIndex();
    shards = new Map();
    rulesDocument = emptyRules();
    rulesRef = null;
    assetsDocument = emptyAssets();
    assetsRef = null;
    assetConflictResolver = null;
    statementConflictResolver = null;
    ruleConflictResolver = null;
    mutationWarning = null;
    hasRemote = false;
    sessionExportable = false;
    hasLegacy = false;
    /** Stable temporary identities prevent duplicate inserts after a partial multi-year save. */
    draftIds = new WeakMap();
    pdfDrafts = new WeakMap();
    constructor(client) {
        this.client = client;
    }
    /** Ask the current user before overwriting any concurrent same-field asset change. */
    setAssetConflictResolver(resolver) {
        this.assetConflictResolver = resolver;
    }
    setStatementConflictResolver(resolver) {
        this.statementConflictResolver = resolver;
    }
    setRuleConflictResolver(resolver) {
        this.ruleConflictResolver = resolver;
    }
    takeMutationWarning() {
        const warning = this.mutationWarning;
        this.mutationWarning = null;
        return warning;
    }
    async approveCollision(items, resolver, domain) {
        if (!items.length)
            return;
        if (!resolver)
            throw new CloudEditCancelledError(`${domain}が別端末でも編集されています。上書きせず停止しました。最新データを取得してください。`);
        let approved = false;
        try {
            approved = await resolver(items);
        }
        catch {
            throw new CloudEditCancelledError(`${domain}の確認画面を開けなかったため保存を停止しました。`);
        }
        if (!approved)
            throw new CloudEditCancelledError(`${domain}の同時編集があったため保存を中止しました。OneDriveの既存内容は変更されていません。`);
    }
    get unlocked() { return this.key !== null; }
    get isRotating() { return this.rotating; }
    get exists() { return this.hasRemote; }
    get needsLayoutMigration() { return this.hasLegacy; }
    records() {
        if (!this.key)
            throw new Error('クラウド保管庫はロックされています。');
        // During a billing-month correction, a new-year copy may exist before old-year cleanup.
        // Prefer the record whose stored year matches its current billing month.
        const merged = new Map();
        for (const [bucket, { document }] of this.shards)
            for (const record of document.records) {
                const rank = statementBucket(record.statement.billingMonth) === bucket ? 1 : 0;
                const previous = merged.get(record.id);
                if (!previous || rank > previous.rank)
                    merged.set(record.id, { record, rank });
            }
        return clone([...merged.values()].map(x => x.record));
    }
    merchantRules() {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        return clone(this.rulesDocument.rules);
    }
    merchantCategories() {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        return clone(listCategories(this.rulesDocument));
    }
    merchantCategoryColors() {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        return clone(this.rulesDocument.categoryColors ?? {});
    }
    payrollReadClient() {
        if (!this.unlocked || this.rotating)
            throw new Error('Finance保管庫を解除してから給与を同期してください。');
        return this.client;
    }
    assetSettings() {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        return clone(this.assetsDocument);
    }
    conflicts() { return [...this.shards.values()].reduce((count, s) => count + s.document.conflicts.length, 0); }
    lock() { this.mutationWarning = null; this.dataSetId = null; this.client.setVaultDataSet?.(null); this.key = null; this.salt = ''; this.sessionExportable = false; this.shards.clear(); this.index = emptyIndex(); this.rulesDocument = emptyRules(); this.rulesRef = null; this.assetsDocument = emptyAssets(); this.assetsRef = null; }
    /** Export a key only after an explicit opt-in unlock; immediately make the working key non-extractable. */
    async exportTabKey() {
        if (!this.key || !this.sessionExportable)
            throw new Error('セッション保存が有効ではありません。');
        const raw = new Uint8Array(await crypto.subtle.exportKey('raw', this.key));
        const encoded = btoa(String.fromCharCode(...raw));
        this.key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        raw.fill(0);
        this.sessionExportable = false;
        return { salt: this.salt, key: encoded, dataSetId: this.dataSetId };
    }
    /** Use the tab-scoped key only after verifying it decrypts the current remote index. */
    async unlockTab(salt, rawKey, dataSetId = null) {
        const bytes = Uint8Array.from(atob(rawKey), c => c.charCodeAt(0));
        if (bytes.length !== 32)
            throw new Error('タブ用の復号鍵が不正です。');
        const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        bytes.fill(0);
        const index = await this.client.readFinanceIndex();
        if (!index)
            throw new Error('OneDriveの保管庫が変更されています。');
        const env = parseIndexEnvelope(index.text);
        if (env.salt !== salt || (env.dataSetId ?? null) !== dataSetId)
            throw new Error('保管庫のパスフレーズが変更されています。再度解除してください。');
        await this.setCurrent(key, salt, index);
        this.sessionExportable = false;
        return this.records();
    }
    async discover() {
        const current = await this.client.readFinanceIndex();
        if (current) {
            this.hasRemote = true;
            this.hasLegacy = false;
            return true;
        }
        const legacy = await this.client.readLiveVault();
        this.hasRemote = !!legacy;
        this.hasLegacy = !!legacy;
        return this.hasRemote;
    }
    /** Read the new layout, with safe recovery of shards committed before the index update. */
    async readCurrent(key, salt, prefetched) {
        const indexFile = prefetched ?? await this.client.readFinanceIndex();
        if (!indexFile)
            throw new Error('OneDriveの暗号化索引が見つかりません。');
        const envelope = parseIndexEnvelope(indexFile.text);
        if (envelope.salt !== salt)
            throw new Error('暗号化索引が異なる保管庫を参照しています。');
        if (this.key && (envelope.dataSetId ?? null) !== this.dataSetId)
            throw new Error('別の端末でパスフレーズが変更されました。保管庫を再解除してください。');
        this.client.setVaultDataSet?.(envelope.dataSetId ?? null);
        const index = await decryptIndex(envelope, key);
        // An upload may have completed just before index registration failed; recover its shard.
        const files = await this.client.listYearFiles();
        const known = new Map(files.map(file => [file.year, file]));
        const years = [...new Set([...index.years, ...known.keys()])];
        const shards = new Map();
        // Limit concurrency to four to avoid an uncontrolled burst of Graph requests.
        // Unchanged years are served entirely from the in-memory ETag cache.
        for (let start = 0; start < years.length; start += 4) {
            const group = years.slice(start, start + 4);
            const results = await Promise.all(group.map(async (year) => {
                const file = known.get(year);
                const cached = this.shards.get(year);
                if (file?.etag && cached && cached.ref.id === file.id && cached.ref.etag === file.etag) {
                    return { year, shard: cached };
                }
                const remote = file && typeof this.client.readListedYearVault === 'function'
                    ? await this.client.readListedYearVault(file)
                    : await this.client.readYearVault(year);
                if (!remote)
                    throw new Error(`OneDriveの${year}年の明細ファイルがありません。復旧してください。`);
                const docEnv = parseEnvelope(remote.text);
                if (docEnv.salt !== salt)
                    throw new Error(`${year}年の明細が別の保管庫で暗号化されています。`);
                const document = await decryptDocument(docEnv, key);
                for (const record of document.records) {
                    if (!record?.id)
                        throw new Error('年別明細に不正なレコードがあります。');
                }
                return { year, shard: { document, ref: { id: remote.id, etag: remote.etag } } };
            }));
            for (const result of results)
                shards.set(result.year, result.shard);
        }
        return { index: validateIndex({ format: 'finance-cloud-index-v1', years }), shards };
    }
    async setCurrent(key, salt, prefetched) {
        const file = prefetched ?? await this.client.readFinanceIndex();
        if (!file)
            throw new Error('OneDriveの暗号化索引が見つかりません。');
        const env = parseIndexEnvelope(file.text);
        this.client.setVaultDataSet?.(env.dataSetId ?? null);
        const { index, shards } = await this.readCurrent(key, salt, file);
        const ruleState = await this.readMerchantRules(key, salt);
        const assetState = await this.readAssets(key, salt);
        this.key = key;
        this.salt = salt;
        this.dataSetId = env.dataSetId ?? null;
        this.index = index;
        this.shards = shards;
        this.rulesDocument = ruleState.document;
        this.rulesRef = ruleState.ref;
        this.assetsDocument = assetState.document;
        this.assetsRef = assetState.ref;
        this.hasRemote = true;
        this.hasLegacy = false;
    }
    async unlock(passphrase, keepTab = false) {
        const current = await this.client.readFinanceIndex();
        if (current) {
            const salt = parseIndexEnvelope(current.text).salt;
            const key = await deriveCloudKey(passphrase, salt, keepTab);
            await this.setCurrent(key, salt, current);
            this.sessionExportable = keepTab;
            return this.records();
        }
        const legacy = await this.client.readLiveVault();
        if (!legacy)
            throw new Error('OneDriveに明細保管庫がありません。最初に作成してください。');
        const envelope = parseEnvelope(legacy.text);
        const key = await deriveCloudKey(passphrase, envelope.salt, keepTab);
        const old = await decryptDocument(envelope, key);
        // Old v1.0 remains untouched. The index is published only after all shards/PDFs verify.
        await this.migrateV1(old, key, envelope.salt);
        await this.setCurrent(key, envelope.salt);
        this.sessionExportable = keepTab;
        return this.records();
    }
    async create(passphrase, keepTab = false) {
        if (passphrase.length < 12)
            throw new Error('パスフレーズは12文字以上にしてください。');
        if (await this.client.readFinanceIndex() || await this.client.readLiveVault())
            throw new Error('OneDriveにはすでに保管庫があります。解除して使用してください。');
        const salt = freshSalt(), key = await deriveCloudKey(passphrase, salt, keepTab);
        await this.client.ensurePayrollNamespace(); // reserved for the future Payroll app, no personal data
        await this.client.writeFinanceIndex(await encryptIndex(emptyIndex(), key, salt), null);
        await this.setCurrent(key, salt);
        this.sessionExportable = keepTab;
    }
    /** Verify that the live index still points to the generation unlocked in this tab. */
    async assertActiveGeneration() {
        if (this.rotating)
            throw new Error('パスフレーズの変更中です。完了後に操作してください。');
        const file = await this.client.readFinanceIndex();
        if (!file)
            throw new Error('OneDriveの保管庫索引が見つかりません。');
        const env = parseIndexEnvelope(file.text);
        if (env.salt !== this.salt || (env.dataSetId ?? null) !== this.dataSetId)
            throw new Error('別の端末でパスフレーズが変更されました。保管庫をロックして再解除してください。');
    }
    /**
     * Copy-on-write passphrase rotation. All active files (including PDF originals)
     * are re-encrypted into a fresh generation. The single index switch is last.
     * An interrupted upload leaves the old index and old ciphertext fully usable.
     * Old generations are deliberately NOT deleted as automatic cleanup could
     * destroy the only recoverable copy after a network/verification failure.
     */
    async changePassphrase(current, next, onProgress) {
        if (!this.key)
            throw new Error('保管庫のロック解除が必要です。');
        if (this.rotating || this.assetsSaving)
            throw new Error('保管庫の更新中です。操作完了後にお試しください。');
        if (next.length < 12)
            throw new Error('新しいパスフレーズは12文字以上にしてください。');
        if (current === next)
            throw new Error('新旧のパスフレーズが同じです。');
        if (typeof this.client.forVaultDataSet !== 'function' || typeof this.client.setVaultDataSet !== 'function')
            throw new Error('OneDriveクライアントがパスフレーズ変更に対応していません。');
        this.rotating = true;
        let published = false;
        let publishing = false;
        let targetGeneration = null;
        try {
            onProgress?.('現在のパスフレーズを照合中…');
            const startFile = await this.client.readFinanceIndex();
            if (!startFile)
                throw new Error('保管庫索引が見つかりません。');
            const startEnv = parseIndexEnvelope(startFile.text);
            if (startEnv.salt !== this.salt || (startEnv.dataSetId ?? null) !== this.dataSetId)
                throw new Error('別の端末で保管庫が更新されました。先に再解除してください。');
            const currentKey = await deriveCloudKey(current, this.salt);
            await decryptIndex(startEnv, currentKey); // Reject an incorrect old passphrase BEFORE any upload.
            // Never publish from a stale local view. Keep the index ETag for atomic activation.
            const { index, shards } = await this.readCurrent(this.key, this.salt, startFile);
            const rules = await this.readMerchantRules(this.key, this.salt);
            const assets = await this.readAssets(this.key, this.salt);
            const originals = new Map();
            for (const { document } of shards.values())
                for (const item of document.records)
                    if (item.originalId) {
                        const month = item.originalMonth ?? item.statement.billingMonth ?? null;
                        originals.set(`${month ?? 'undated'}:${item.originalId}`, { id: item.originalId, month });
                    }
            const generation = crypto.randomUUID();
            targetGeneration = generation;
            const target = this.client.forVaultDataSet(generation);
            const salt = freshSalt();
            const key = await deriveCloudKey(next, salt);
            let completed = 0;
            const total = shards.size + originals.size + (rules.ref ? 1 : 0) + (assets.ref ? 1 : 0);
            const progress = () => onProgress?.(`再暗号化して保存中… ${completed}/${total}ファイル`);
            progress();
            for (const [year, shard] of shards) {
                const cipher = await encryptDocument(shard.document, key, salt);
                await target.writeYearVault(year, cipher, null);
                const verified = await target.readYearVault(year);
                if (!verified || JSON.stringify(await decryptDocument(parseEnvelope(verified.text), key)) !== JSON.stringify(shard.document))
                    throw new Error(`${year}年の再暗号化検証に失敗しました。`);
                completed++;
                progress();
            }
            if (rules.ref) {
                await target.writeMerchantRules(await encryptRules(rules.document, key, salt), null);
                const file = await target.readMerchantRules();
                if (!file || JSON.stringify(await decryptRules(file.text, key, salt)) !== JSON.stringify(rules.document))
                    throw new Error('利用先ルールの再暗号化検証に失敗しました。');
                completed++;
                progress();
            }
            if (assets.ref) {
                await target.writeAssetSettings(await encryptAssets(assets.document, key, salt), null);
                const file = await target.readAssetSettings();
                if (!file || JSON.stringify(await decryptAssets(file.text, key, salt)) !== JSON.stringify(assets.document))
                    throw new Error('資産設定の再暗号化検証に失敗しました。');
                completed++;
                progress();
            }
            for (const { id, month } of originals.values()) {
                const source = await this.client.downloadDatedOriginal(id, month);
                const decrypted = await decryptOriginal(source, this.key);
                const cipher = await encryptOriginal(decrypted, key);
                await target.uploadDatedOriginal(id, cipher, month);
                const saved = await target.downloadDatedOriginal(id, month);
                const verified = await decryptOriginal(saved, key);
                if (verified.length !== decrypted.length || !verified.every((byte, i) => byte === decrypted[i]))
                    throw new Error('PDF原本の再暗号化検証に失敗しました。');
                completed++;
                progress();
            }
            onProgress?.('他端末での更新がないか最終確認中…');
            // Confirm there were no changes to any source file during the staging run.
            const checkIndex = await this.client.readFinanceIndex();
            if (!checkIndex || checkIndex.etag !== startFile.etag)
                throw new Error('作業中に索引が変更されました。旧データはそのままです。再実行してください。');
            const nowFiles = await this.client.listYearFiles();
            const actual = new Map(nowFiles.map(file => [file.year, file]));
            if (actual.size !== shards.size || [...shards].some(([year, shard]) => actual.get(year)?.etag !== shard.ref.etag))
                throw new Error('作業中に明細が更新されました。旧データはそのままです。再実行してください。');
            const nowRules = await this.client.readMerchantRules();
            const nowAssets = await this.client.readAssetSettings();
            if ((nowRules?.etag ?? null) !== (rules.ref?.etag ?? null) || (nowAssets?.etag ?? null) !== (assets.ref?.etag ?? null))
                throw new Error('作業中に設定が更新されました。旧データはそのままです。再実行してください。');
            onProgress?.('新しい暗号化保管庫に切り替え中…');
            publishing = true;
            await this.client.writeFinanceIndex(await encryptIndex(index, key, salt, generation), { id: startFile.id, etag: startFile.etag });
            published = true;
            // The index publication is a single conditional Graph update. All data was
            // verified before this point; the old data is still available as recovery.
            this.key = null;
            await this.setCurrent(key, salt);
            this.sessionExportable = false;
        }
        catch (error) {
            // Graph may commit a file and then lose the HTTP response. Never claim the
            // old passphrase is authoritative without checking the published index.
            if (publishing && !published && targetGeneration) {
                try {
                    const latest = await this.client.readFinanceIndex();
                    if (latest) {
                        const current = parseIndexEnvelope(latest.text);
                        if (current.dataSetId === targetGeneration)
                            published = true;
                        else if (current.salt === this.salt && (current.dataSetId ?? null) === this.dataSetId)
                            publishing = false;
                    }
                }
                catch { /* Connection unavailable: state must be treated as uncertain. */ }
            }
            if (published) {
                this.lock();
                throw new Error('切り替えは完了しましたが、再読み込みに失敗しました。保管庫を新しいパスフレーズで解除してください。');
            }
            if (publishing && !(error instanceof GraphError && [409, 412].includes(error.status))) {
                this.lock();
                throw new Error('保管庫の切り替え中に通信が途切れ、結果を確認できませんでした。再接続して新しいパスフレーズで解除し、開けなければ以前のパスフレーズを使用してください。');
            }
            throw error;
        }
        finally {
            this.rotating = false;
        }
    }
    /** Legacy -> finance/index.enc + finance/statements/YYYY.enc + finance/originals/YYYY/MM/UUID.enc.
     * Idempotent and non-destructive. Do not publish index.enc before all files validate. */
    async migrateV1(old, key, salt) {
        const byYear = new Map();
        const bucket = (year) => {
            let doc = byYear.get(year);
            if (!doc) {
                doc = emptyDocument();
                byYear.set(year, doc);
            }
            return doc;
        };
        for (const record of old.records) {
            const year = statementBucket(record.statement.billingMonth);
            const copy = clone(record);
            if (copy.originalId) {
                // Legacy originals were at the app root. Their ciphertext is already valid with this key.
                const original = await this.client.downloadOriginal(copy.originalId);
                const month = copy.originalMonth ?? copy.statement.billingMonth;
                try {
                    await this.client.uploadDatedOriginal(copy.originalId, original, month);
                }
                catch (error) {
                    if (!isConflict(error))
                        throw error;
                    const existing = await this.client.downloadDatedOriginal(copy.originalId, month);
                    if (existing !== original)
                        throw new Error('移行先PDF原本が既存ファイルと一致しません。');
                }
                // Read back before allowing any index to point to this original.
                if (await this.client.downloadDatedOriginal(copy.originalId, month) !== original)
                    throw new Error('PDF原本の移行検証に失敗しました。');
                copy.originalMonth = month;
            }
            bucket(year).records.push(copy);
        }
        // The year is unknown for tombstones of already-deleted records.
        if (old.deleted.length)
            bucket('undated').deleted.push(...old.deleted);
        for (const conflict of old.conflicts) {
            const rec = old.records.find(r => r.id === conflict.recordId);
            bucket(statementBucket(rec?.statement.billingMonth)).conflicts.push(clone(conflict));
        }
        const years = [...byYear.keys()].sort();
        for (const year of years) {
            const expected = byYear.get(year);
            let file = await this.client.readYearVault(year);
            if (!file) {
                try {
                    await this.client.writeYearVault(year, await encryptDocument(expected, key, salt), null);
                }
                catch (error) {
                    if (!isConflict(error))
                        throw error;
                }
                file = await this.client.readYearVault(year);
            }
            if (!file)
                throw new Error(`${year}年の明細移行に失敗しました。`);
            const env = parseEnvelope(file.text);
            if (env.salt !== salt)
                throw new Error('移行先の暗号化ソルトが異なります。');
            const actual = await decryptDocument(env, key);
            if (JSON.stringify(actual) !== JSON.stringify(expected))
                throw new Error(`${year}年の移行先データが一致しません。旧保管庫は保持されています。`);
        }
        await this.client.ensurePayrollNamespace();
        // A competing client may have completed migration while we were working.
        try {
            await this.client.writeFinanceIndex(await encryptIndex({ format: 'finance-cloud-index-v1', years }, key, salt), null);
        }
        catch (error) {
            if (!isConflict(error))
                throw error;
        }
        const check = await this.client.readFinanceIndex();
        if (!check)
            throw new Error('クラウド索引の移行検証に失敗しました。');
        const env = parseIndexEnvelope(check.text);
        if (env.salt !== salt)
            throw new Error('移行中に別のクラウド保管庫が作成されました。');
        const index = await decryptIndex(env, key);
        if (years.some(year => !index.years.includes(year)))
            throw new Error('クラウド索引に移行済み年度が登録されていません。');
    }
    /** Loading an absent rule file is valid for existing installations. */
    async readMerchantRules(key, salt) {
        // Older isolated test doubles may not expose the new optional Graph endpoint.
        if (typeof this.client.readMerchantRules !== 'function')
            return { document: emptyRules(), ref: null };
        const remote = await this.client.readMerchantRules();
        if (!remote)
            return { document: emptyRules(), ref: null };
        const document = await decryptRules(remote.text, key, salt);
        return { document, ref: { id: remote.id, etag: remote.etag } };
    }
    async upsertMerchantRule(rule) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        const valid = validateRule(rule);
        const next = clone(this.rulesDocument);
        const index = next.rules.findIndex(x => x.id === valid.id);
        if (index >= 0)
            next.rules[index] = valid;
        else
            next.rules.push(valid);
        next.deleted = next.deleted.filter(x => x !== valid.id);
        await this.commitMerchantRules(next);
    }
    async setCategoryColor(id, color) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        if (!CATEGORIES.some(c => c.id === id) || !PALETTE.some(c => c.id === color))
            throw new Error('カテゴリーの色設定が不正です。');
        const next = clone(this.rulesDocument);
        next.categoryColors = { ...next.categoryColors, [id]: color };
        if (next.categoryDefinitions)
            next.categoryDefinitions = next.categoryDefinitions.map(item => item.id === id ? { ...item, color } : item);
        await this.commitMerchantRules(next);
    }
    async upsertCategory(category) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        const valid = validateCategory(category);
        const next = clone(this.rulesDocument);
        const existing = listCategories(next);
        if (existing.some(item => item.id !== valid.id && item.name.toLocaleLowerCase() === valid.name.toLocaleLowerCase()))
            throw new Error('同じ名前のカテゴリーがすでにあります。');
        if (next.deletedCategories?.includes(valid.id))
            throw new Error('削除したカテゴリーIDは再利用できません。');
        const list = next.categoryDefinitions ?? [];
        const position = list.findIndex(item => item.id === valid.id);
        if (position >= 0)
            list[position] = valid;
        else
            list.push(valid);
        next.categoryDefinitions = list;
        await this.commitMerchantRules(next);
    }
    /** Commit a complete modal edit in one encrypted Graph transaction, including removals. */
    async applyCategoryBatch(changes) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        const upserts = changes.upserts.map(validateCategory);
        const removeIds = new Set(changes.removeIds);
        if (upserts.some(item => removeIds.has(item.id)))
            throw new Error('更新と削除が重複しています。');
        const next = clone(this.rulesDocument);
        const existing = listCategories(next);
        for (const id of removeIds) {
            if (!existing.some(item => item.id === id))
                throw new Error('削除対象のカテゴリーが存在しません。');
        }
        for (const category of upserts) {
            if (next.deletedCategories?.includes(category.id))
                throw new Error('削除済みのカテゴリーIDは再利用できません。');
        }
        const final = new Map(existing.filter(item => !removeIds.has(item.id)).map(item => [item.id, item]));
        for (const category of upserts)
            final.set(category.id, category);
        if (final.size > 160)
            throw new Error('カテゴリー数が上限を超えています。');
        const names = new Set();
        for (const item of final.values()) {
            const key = item.name.normalize('NFKC').toLocaleLowerCase();
            if (names.has(key))
                throw new Error('同じ名前のカテゴリーが重複しています。');
            names.add(key);
        }
        next.rules = next.rules.map(rule => rule.categoryId && removeIds.has(rule.categoryId) ? { ...rule, categoryId: null } : rule);
        next.categoryDefinitions = (next.categoryDefinitions ?? []).filter(item => !removeIds.has(item.id));
        for (const category of upserts) {
            const idx = next.categoryDefinitions.findIndex(item => item.id === category.id);
            if (idx >= 0)
                next.categoryDefinitions[idx] = category;
            else
                next.categoryDefinitions.push(category);
        }
        if (removeIds.size) {
            next.deletedCategories = [...new Set([...(next.deletedCategories ?? []), ...removeIds])];
            if (next.categoryColors)
                for (const id of removeIds)
                    delete next.categoryColors[id];
        }
        await this.commitMerchantRules(next);
    }
    async removeCategory(id) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        if (!listCategories(this.rulesDocument).some(item => item.id === id))
            throw new Error('対象のカテゴリーがありません。');
        const next = clone(this.rulesDocument);
        const used = next.rules.filter(rule => rule.categoryId === id).length;
        next.rules = next.rules.map(rule => rule.categoryId === id ? { ...rule, categoryId: null } : rule);
        next.categoryDefinitions = (next.categoryDefinitions ?? []).filter(item => item.id !== id);
        next.deletedCategories = [...new Set([...(next.deletedCategories ?? []), id])];
        if (next.categoryColors)
            delete next.categoryColors[id];
        await this.commitMerchantRules(next);
        return used;
    }
    async removeMerchantRule(id) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        const next = clone(this.rulesDocument);
        next.rules = next.rules.filter(rule => rule.id !== id);
        if (!next.deleted.includes(id))
            next.deleted.push(id);
        await this.commitMerchantRules(next);
    }
    async commitMerchantRules(local) {
        if (!this.key)
            throw new Error('保管庫がロックされています。');
        await this.assertActiveGeneration();
        if (typeof this.client.writeMerchantRules !== 'function')
            throw new Error('OneDriveの利用先ルール保存機能がありません。');
        const key = this.key, base = clone(this.rulesDocument);
        for (let attempt = 0; attempt < 5; attempt++) {
            const remote = await this.client.readMerchantRules();
            if (this.rulesRef && !remote)
                throw new Error('OneDriveの利用先ルールファイルが消去されています。上書きせず停止します。');
            const remoteDoc = remote ? await decryptRules(remote.text, key, this.salt) : emptyRules();
            const collisions = detectRuleEditCollisions(base, local, remoteDoc);
            await this.approveCollision(collisions, this.ruleConflictResolver, '利用先ルール・カテゴリー');
            const merged = mergeRules(base, local, remoteDoc, new Date().toISOString(), undefined, collisions.length > 0);
            try {
                const result = await this.client.writeMerchantRules(await encryptRules(merged, key, this.salt), remote ? { id: remote.id, etag: remote.etag } : null);
                if (result?.id && result.etag) {
                    this.rulesDocument = merged;
                    this.rulesRef = { id: result.id, etag: result.etag };
                }
                else {
                    const verified = await this.readMerchantRules(key, this.salt);
                    if (!verified.ref || JSON.stringify(verified.document) !== JSON.stringify(merged))
                        throw new CloudWriteUncertainError('利用先ルールの保存結果を確認できません。再取得して照合してください。', null);
                    this.rulesDocument = verified.document;
                    this.rulesRef = verified.ref;
                }
                return;
            }
            catch (error) {
                if (isConflict(error))
                    continue;
                throw error;
            }
        }
        throw new Error('利用先ルールの同時更新が続いています。再試行してください。');
    }
    async readAssets(key, salt) {
        // Existing vaults may not have an assets file yet; do not create one until first save.
        if (typeof this.client.readAssetSettings !== 'function')
            return { document: emptyAssets(), ref: null };
        const remote = await this.client.readAssetSettings();
        if (!remote)
            return { document: emptyAssets(), ref: null };
        return { document: await decryptAssets(remote.text, key, salt), ref: { id: remote.id, etag: remote.etag } };
    }
    async addBalanceSnapshot(snapshot) {
        await this.addBalanceSnapshots([snapshot]);
    }
    /** Saves all entered account balances in a single encrypted Graph commit. */
    async addBalanceSnapshots(snapshots) {
        if (!this.key)
            throw new Error('OneDrive保管庫を解除してください。');
        if (!snapshots.length)
            throw new Error('登録する残高がありません。');
        const next = clone(this.assetsDocument);
        const usedIds = new Set([...next.snapshots.map(item => item.id), ...next.deletedSnapshots]);
        for (const snapshot of snapshots) {
            const valid = validateSnapshot(snapshot);
            if (usedIds.has(valid.id))
                throw new Error('同じ残高記録IDは登録できません。');
            usedIds.add(valid.id);
            next.snapshots.push(valid);
        }
        await this.commitAssets(next);
    }
    async deleteBalanceSnapshot(id) {
        if (!this.key)
            throw new Error('OneDrive保管庫を解除してください。');
        const next = clone(this.assetsDocument);
        if (!next.snapshots.some(item => item.id === id))
            throw new Error('削除対象の残高記録がありません。');
        next.snapshots = next.snapshots.filter(item => item.id !== id);
        next.deletedSnapshots.push(id);
        await this.commitAssets(next);
    }
    /** Single dated movements are encrypted with the rest of assets.enc. */
    async upsertOneTime(entry) {
        if (!this.key)
            throw new Error('OneDrive保管庫を解除してください。');
        const valid = validateOneTime(entry), next = clone(this.assetsDocument);
        if (next.deletedOneTime?.includes(valid.id))
            throw new Error('削除済みの入出金IDは再利用できません。');
        const items = next.oneTime ?? [];
        const i = items.findIndex(e => e.id === valid.id);
        if (i >= 0)
            items[i] = valid;
        else
            items.push(valid);
        next.oneTime = items;
        await this.commitAssets(next);
    }
    async deleteOneTime(id) {
        if (!this.key)
            throw new Error('OneDrive保管庫を解除してください。');
        const next = clone(this.assetsDocument);
        if (!next.oneTime?.some(e => e.id === id))
            throw new Error('対象の単発入出金が見つかりません。');
        next.oneTime = next.oneTime.filter(e => e.id !== id);
        next.deletedOneTime = [...(next.deletedOneTime ?? []), id];
        await this.commitAssets(next);
    }
    async upsertRecurring(entry) {
        if (!this.key)
            throw new Error('OneDrive保管庫を解除してください。');
        const valid = validateRecurring(entry), next = clone(this.assetsDocument);
        if (next.deletedRecurring.includes(valid.id))
            throw new Error('削除済みの定期入出金IDは再利用できません。');
        const index = next.recurring.findIndex(item => item.id === valid.id);
        if (index >= 0)
            next.recurring[index] = valid;
        else
            next.recurring.push(valid);
        await this.commitAssets(next);
    }
    async setPayrollDepositAccount(account) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        const next = clone(this.assetsDocument);
        next.payrollDepositAccount = account;
        await this.commitAssets(next);
    }
    /** Opt-in credential is stored only in the AES-GCM protected assets document. */
    async setPayrollAutoPassphrase(passphrase) {
        if (!this.key)
            throw new Error('OneDrive保管庫のロック解除が必要です。');
        const next = clone(this.assetsDocument);
        next.payrollAutoPassphrase = validatePayrollAutoPassphrase(passphrase);
        await this.commitAssets(next);
    }
    async setNisaCardRule(rule) {
        if (!this.key)
            throw new Error('OneDrive保管庫を解除してください。');
        const next = clone(this.assetsDocument);
        next.nisaCardRule = validateNisaCardRule(rule);
        await this.commitAssets(next);
    }
    async setBirthMonth(value) {
        if (!this.key)
            throw new Error('保管庫を解除してください。');
        const next = clone(this.assetsDocument);
        const born = validateBirthMonth(value);
        if (born)
            next.birthMonth = born;
        else
            delete next.birthMonth;
        await this.commitAssets(next);
    }
    async setMizuhoTransferPlan(value) {
        if (!this.key)
            throw new Error('保管庫を解除してください。');
        const next = clone(this.assetsDocument);
        next.mizuhoTransferPlan = validateMizuhoPlan(value);
        if (value.enabled)
            next.cardDebitAccounts = { ...next.cardDebitAccounts, 'rakuten-mizuho': 'mizuho-bank' };
        await this.commitAssets(next);
    }
    async setCardDebitAccounts(value) {
        if (!this.key)
            throw new Error('保管庫を解除してください。');
        const next = clone(this.assetsDocument);
        next.cardDebitAccounts = validateCardDebitAccounts(value) ?? {};
        await this.commitAssets(next);
    }
    async deleteRecurring(id) {
        if (!this.key)
            throw new Error('OneDrive保管庫を解除してください。');
        const next = clone(this.assetsDocument);
        if (!next.recurring.some(item => item.id === id))
            throw new Error('削除対象の定期入出金がありません。');
        next.recurring = next.recurring.filter(item => item.id !== id);
        next.deletedRecurring.push(id);
        await this.commitAssets(next);
    }
    /** A single serialized assets document is saved with Graph ETag and three-way merge. */
    assetsSaving = false;
    async commitAssets(local) {
        await this.assertActiveGeneration();
        if (!this.key)
            throw new Error('OneDrive保管庫がロックされています。');
        if (typeof this.client.writeAssetSettings !== 'function')
            throw new Error('OneDriveの資産設定保存機能がありません。');
        if (this.assetsSaving)
            throw new Error('資産設定を保存中です。完了後にもう一度操作してください。');
        this.assetsSaving = true;
        try {
            const key = this.key, base = clone(this.assetsDocument);
            for (let attempt = 0; attempt < 5; attempt++) {
                const remote = await this.client.readAssetSettings();
                if (this.assetsRef && !remote)
                    throw new Error('資産設定ファイルがOneDriveから消失しています。上書きせず停止します。');
                const current = remote ? await decryptAssets(remote.text, key, this.salt) : emptyAssets();
                const collisions = detectAssetsEditCollisions(base, local, current);
                if (collisions.length) {
                    if (!this.assetConflictResolver)
                        throw new CloudEditCancelledError('別の端末でも同じ資産項目が変更されています。保存を停止しました。最新データを取得して確認してください。');
                    const details = describeAssetsEditCollisions(base, local, current, collisions);
                    const approved = await this.assetConflictResolver(collisions, details);
                    if (!approved)
                        throw new CloudEditCancelledError('同時編集のため保存を中止しました。OneDriveの内容は変更されていません。');
                }
                const merged = mergeAssets(base, local, current, new Date().toISOString(), collisions.length > 0);
                try {
                    const result = await this.client.writeAssetSettings(await encryptAssets(merged, key, this.salt), remote ? { id: remote.id, etag: remote.etag } : null);
                    if (result?.id && result.etag) {
                        this.assetsDocument = merged;
                        this.assetsRef = { id: result.id, etag: result.etag };
                    }
                    else {
                        const verified = await this.readAssets(key, this.salt);
                        if (!verified.ref || JSON.stringify(verified.document) !== JSON.stringify(merged))
                            throw new Error('資産設定の保存結果を確認できません。最新データを取得してください。');
                        this.assetsDocument = verified.document;
                        this.assetsRef = verified.ref;
                    }
                    return;
                }
                catch (error) {
                    if (isConflict(error))
                        continue;
                    throw error;
                }
            }
            throw new Error('資産設定の同時更新が続いています。再試行してください。');
        }
        finally {
            this.assetsSaving = false;
        }
    }
    findBucket(id) {
        for (const [year, { document }] of this.shards)
            if (document.records.some(x => x.id === id))
                return year;
        return null;
    }
    working(year, changes) {
        let doc = changes.get(year);
        if (!doc) {
            doc = clone(this.shards.get(year)?.document ?? emptyDocument());
            changes.set(year, doc);
        }
        return doc;
    }
    async saveBatch(items) {
        if (!this.key)
            throw new Error('先にOneDrive保管庫を解除してください。');
        await this.assertActiveGeneration();
        const key = this.key;
        const changes = new Map();
        const ids = [];
        const moves = [];
        for (const item of items) {
            let id = item.id ?? this.draftIds.get(item.statement);
            if (!id) {
                id = crypto.randomUUID();
                this.draftIds.set(item.statement, id);
            }
            ids.push(id);
            const prior = this.records().find(r => r.id === id);
            const previousBucket = this.findBucket(id);
            const year = statementBucket(item.statement.billingMonth);
            let originalId = prior?.originalId;
            let originalMonth = prior?.originalMonth ?? prior?.statement.billingMonth ?? null;
            if (item.statement.sourceKind === 'pdf' && item.source) {
                if (item.source.mime !== 'application/pdf')
                    throw new Error('PDF原本のファイル形式が不正です。');
                // Deterministic across retries for a draft; never overwrite an existing encrypted PDF.
                let draft = this.pdfDrafts.get(item.source.bytes);
                if (!draft) {
                    draft = { id: crypto.randomUUID(), month: item.statement.billingMonth, encrypted: await encryptOriginal(item.source.bytes, key) };
                    this.pdfDrafts.set(item.source.bytes, draft);
                }
                originalId = draft.id;
                originalMonth = draft.month;
                try {
                    await this.client.uploadDatedOriginal(originalId, draft.encrypted, originalMonth);
                }
                catch (error) {
                    if (!isConflict(error))
                        throw error;
                    // Retrying the same upload is safe only when the immutable ciphertext matches.
                    const existing = await this.client.downloadDatedOriginal(originalId, originalMonth);
                    if (existing !== draft.encrypted)
                        throw new Error('PDF原本の識別子が既存ファイルと衝突しました。');
                }
            }
            if (item.statement.sourceKind === 'pdf' && !originalId)
                throw new Error('PDF原本がないため保存できません。');
            const record = { id, statement: clone(item.statement), ...(originalId ? { originalId, originalMonth } : {}) };
            const target = this.working(year, changes);
            const index = target.records.findIndex(r => r.id === id);
            if (index >= 0)
                target.records[index] = record;
            else
                target.records.push(record);
            target.deleted = target.deleted.filter(x => x !== id);
            if (previousBucket && previousBucket !== year)
                moves.push({ id, from: previousBucket, to: year });
        }
        // Multi-year writes are not atomic. Distinguish an uncertain result from a rejected edit.
        this.mutationWarning = null;
        let committedYears = 0;
        try {
            // First put records into their destinations; only afterwards tombstone old-year copies.
            for (const [year, updated] of changes) {
                await this.commitYear(year, updated);
                committedYears++;
            }
            for (const move of moves) {
                const old = this.working(move.from, new Map());
                old.records = old.records.filter(r => r.id !== move.id);
                if (!old.deleted.includes(move.id))
                    old.deleted.push(move.id);
                await this.commitYear(move.from, old);
                committedYears++;
            }
        }
        catch (error) {
            if (error instanceof CloudEditCancelledError && committedYears === 0)
                throw error;
            throw new CloudWriteUncertainError('一部または全部の明細は保存済みの可能性があります。再保存する前に最新データを取得して確認してください。', error);
        }
        try {
            await this.refresh();
        }
        catch {
            this.mutationWarning = 'OneDriveへの保存は確認できましたが、最後の最新データ取得に失敗しました。通信回復後に取得してください。';
        }
        return ids;
    }
    async delete(id) {
        if (!this.key)
            throw new Error('先にOneDrive保管庫を解除してください。');
        await this.assertActiveGeneration();
        // Multiple copies can temporarily exist while moving billing months; remove all.
        const years = [...this.shards].filter(([, s]) => s.document.records.some(r => r.id === id)).map(([year]) => year);
        this.mutationWarning = null;
        let deletedYears = 0;
        try {
            for (const year of years) {
                const changed = clone(this.shards.get(year).document);
                changed.records = changed.records.filter(r => r.id !== id);
                if (!changed.deleted.includes(id))
                    changed.deleted.push(id);
                await this.commitYear(year, changed);
                deletedYears++;
            }
        }
        catch (error) {
            if (error instanceof CloudEditCancelledError && deletedYears === 0)
                throw error;
            throw new CloudWriteUncertainError('明細の削除がOneDriveで完了している可能性があります。再操作せず最新データを取得してください。', error);
        }
        try {
            await this.refresh();
        }
        catch {
            this.mutationWarning = '明細の削除は確認できましたが、最新データ取得に失敗しました。通信回復後に取得してください。';
        }
        // Originals are retained for recovery; audited cleanup is a separate operation.
    }
    async registerYear(year) {
        if (!this.key)
            throw new Error('ロックされています。');
        if (this.index.years.includes(year))
            return; // This shard was registered earlier.
        for (let attempt = 0; attempt < 5; attempt++) {
            const file = await this.client.readFinanceIndex();
            if (!file)
                throw new Error('OneDriveの索引がなくなりました。');
            const env = parseIndexEnvelope(file.text);
            if (env.salt !== this.salt || (env.dataSetId ?? null) !== this.dataSetId)
                throw new Error('異なる暗号化索引です。');
            const index = await decryptIndex(env, this.key);
            if (index.years.includes(year)) {
                this.index = index;
                return;
            }
            const changed = { ...index, years: [...index.years, year].sort() };
            try {
                await this.client.writeFinanceIndex(await encryptIndex(changed, this.key, this.salt, this.dataSetId), { id: file.id, etag: file.etag });
                this.index = changed;
                return;
            }
            catch (error) {
                if (isConflict(error))
                    continue;
                throw error;
            }
        }
        throw new Error('OneDrive索引の同時更新が続いています。再試行してください。');
    }
    async commitYear(year, changed) {
        if (!this.key)
            throw new Error('保管庫はロックされています。');
        const base = clone(this.shards.get(year)?.document ?? emptyDocument());
        for (let attempt = 0; attempt < 5; attempt++) {
            const currentRef = this.shards.get(year)?.ref ?? null;
            const check = typeof this.client.readYearVaultForSave === 'function'
                ? await this.client.readYearVaultForSave(year, currentRef)
                : { kind: 'remote', file: await this.client.readYearVault(year) };
            const remote = check.kind === 'unchanged' ? currentRef : check.file;
            let latest = check.kind === 'unchanged' ? clone(base) : emptyDocument();
            if (check.kind === 'remote' && check.file) {
                const env = parseEnvelope(check.file.text);
                if (env.salt !== this.salt)
                    throw new Error('別の暗号化保管庫が同じ年度に存在します。');
                latest = await decryptDocument(env, this.key);
            }
            const collisions = detectDocumentEditCollisions(base, changed, latest);
            await this.approveCollision(collisions, this.statementConflictResolver, 'カード明細');
            const merged = mergeDocuments(base, changed, latest, new Date().toISOString(), undefined, collisions.length > 0);
            try {
                const result = await this.client.writeYearVault(year, await encryptDocument(merged, this.key, this.salt), remote ? { id: remote.id, etag: remote.etag } : null);
                if (result?.id && result.etag) {
                    // This ETag belongs to exactly the document we uploaded. If another
                    // device updates afterwards, the next refresh detects its new ETag.
                    this.shards.set(year, { document: merged, ref: { id: result.id, etag: result.etag } });
                }
                else {
                    // Compatibility fallback for Graph responses without a usable ETag.
                    // Never pair our local document with an unrelated remote ETag.
                    const saved = await this.client.readYearVault(year);
                    if (!saved)
                        throw new Error('年別明細の保存結果を確認できません。');
                    const verifiedEnvelope = parseEnvelope(saved.text);
                    if (verifiedEnvelope.salt !== this.salt)
                        throw new Error('保存直後に暗号化保管庫が変更されました。');
                    const verifiedDocument = await decryptDocument(verifiedEnvelope, this.key);
                    if (JSON.stringify(verifiedDocument) !== JSON.stringify(merged))
                        throw new CloudWriteUncertainError('年別明細の保存結果が他の編集と異なります。最新データを確認してください。', null);
                    this.shards.set(year, { document: verifiedDocument, ref: { id: saved.id, etag: saved.etag } });
                }
                await this.registerYear(year);
                return;
            }
            catch (error) {
                if (isConflict(error))
                    continue;
                throw error;
            }
        }
        throw new Error(`${year}年の同時更新が続いています。未保存データを保持して再試行してください。`);
    }
    async refresh() {
        if (!this.key)
            throw new Error('先にOneDrive保管庫を解除してください。');
        await this.assertActiveGeneration();
        const { index, shards } = await this.readCurrent(this.key, this.salt);
        const rules = await this.readMerchantRules(this.key, this.salt);
        const assets = await this.readAssets(this.key, this.salt);
        this.index = index;
        this.shards = shards;
        this.rulesDocument = rules.document;
        this.rulesRef = rules.ref;
        this.assetsDocument = assets.document;
        this.assetsRef = assets.ref;
        return this.records();
    }
    async original(id) {
        if (!this.key)
            throw new Error('クラウド保管庫はロックされています。');
        const record = this.records().find(r => r.id === id);
        if (!record?.originalId)
            return null;
        return decryptOriginal(await this.client.downloadDatedOriginal(record.originalId, record.originalMonth ?? record.statement.billingMonth), this.key);
    }
}
