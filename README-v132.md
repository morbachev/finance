# Finance v1.3.2 | Payrollの実収入を読み取り連携

適用元: Finance v1.3.1。Financeの暗号化保管庫・Graph保存形式・データセット切替には変更なし。

## 追加機能
- Payroll v1.1.0以降が自動公開する `payroll/income/YYYY.enc` を**読み取り専用**で参照。`payroll/index.enc` の索引とパスフレーズ変更世代（`versions/<UUID>/income/`）にも対応。
- Payroll独自のAES-256-GCM/PBKDF2(310,000回)・AADに合わせて復号。**Payrollのパスフレーズは入力後直ちに欄を消去し、非抽出CryptoKeyだけをタブ内メモリ保持**。localStorage、IndexedDB、OneDriveへ保存しない。
- Payrollの既存公開形式（支給日、対象年月、勤務先、本業/副業、手取り、明細ID、改訂番号）に対応。v1.1.1以降の額面と課税支給額は任意フィールドとして取得。未提供の額面は `null` にし、0円とみなさない。
- Finance設定画面に給与同期欄と、給与の入金先（加算しない/楽天銀行/貯金口座）の明示指定を追加。入金先は既存 `finance/settings/assets.enc` に暗号化保存し、3方向マージにも対応。
- 同期済み給与を`paidOn`基準で月別に表示。楽天銀行の残高予測に**確認済み残高の日付より後の給与だけ**を手取りで加算。未同期では見積もりに給与を含めず、警告を表示。
- 一度同期した後、同じタブでは再同期可能。Financeの最新データ取得時、前回から10分以上経過していればPayrollも再取得。

## 注意
- **実際のOneDrive Graph通信はユーザーのアカウントで要確認**。認証はFinanceとPayrollの同一Entra Client ID/AppFolderに依存する。
- FinanceとPayrollのパスフレーズが異なっていても連携できる。ただしタブ再起動時はPayrollのパスフレーズを再入力する。
- **手取りの入金先は実際の振込先を確認してから有効にする**。別途登録した「給与の定期入金」と同時加算すると二重計上になる。カード請求の銀行からの引落・みずほ銀行への送金は今回未実装。
- NISA評価損益は反映せず、既存の積立額加算仕様を維持する。
- 「給与の支給日」はPayrollの記録値。未登録の将来給与は予測して足さない。
- 古いFinance版で `assets.enc` を編集すると給与の入金先設定が失われ得るため、Mac/Galaxy双方を更新すること。

## Macに適用
```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v132-payroll-link-patch.zip -d ~/Documents/finance
npm run check
npm run test
npm run verify:cloud
```
`dist/` は同梱済み。`⌘+Shift+R`で更新。
