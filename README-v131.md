# Finance v1.3.1 | Payroll連携の計算基盤（第一段階）

**適用元：Finance v1.3.0。** このパッチは既存のUI、明細、パスフレーズ、暗号化OneDriveファイルの読み書き形式を変更しません。

## 実装済み

- `src/cloud/payroll-income.ts` に、Payrollが将来公開する**年別収入データ専用**の最小契約 `payroll-income-v1` と入力バリデーターを用意。
- `paidOn`（実支給日）基準の月別・暦年集計。手取り`netPay`と額面`grossPay`を分けて計算。給与対象月`payPeriod`と実際の振込月を混同しません。
- 同一の給与ID重複、不正日付、負数、JPY以外、取り消し済みID、年度不整合、金額オーバーフローを考慮。
- `forecastAssets()` に、実際のPayroll収入が提供され、かつ入金先口座を**明示指定した場合だけ**、確認済み残高以降の手取りを加算できるオプション引数を追加。給与入金未接続の場合の計算は従来のv1.3.0と同一です。
- 既存の定期入出金・NISA積立額の計算を維持。銀行への実際のカード引落や給与予測は勝手に推定しません。

## まだ実装していないこと（重要）

- **PayrollからのOneDrive自動取得と復号、Payroll側の収入公開ファイル生成、UIへの給与表示は未実装**。今回はFinanceの計算基盤のみです。Payroll最新版の実ソースを確認できないため、暗号方式や保存ファイルを推測して繋ぐことは避けました。
- `payroll-income-v1` は暫定データ契約です。Payrollからの公開ファイル形式と鍵共有方式は、Payroll最新版を確認してから確定します。
- 実際の給与が銀行残高へ反映される段階では、給与の定期入金ルールを同時に登録すると二重計上の恐れがあります。次の統合工程で競合を検出・案内します。

## 次の工程

1. Payrollの最新版ソース（`src/`、`public/`、`scripts/`、`package.json`など、機密データなし）を確認。
2. Payroll側で読み取り用の専用収入データを年別に暗号化して出力。元の給与明細・PDFの保存方式は変えない。
3. Financeから同一AppFolderの`payroll/`を**読み取り専用**で取得して、鍵の扱いと正確な整合性検査を実装。
4. Finance設定で給与の入金先口座を選択し、残高予測へ反映。月別・年別サマリーに反映。

## Macへの適用

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v131-payroll-income-foundation.zip -d ~/Documents/finance
npm run check
npm run test
npm run verify:cloud
```

ソースに対する型チェックとテストを実行済み。実Microsoft Graph通信は行っていません。
