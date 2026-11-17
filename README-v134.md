# Finance v1.3.4 | Payroll自動連携・設定画面への移設

適用元: ユーザー提供の `finance(3).zip`（Finance v1.3.3）。

## 変更
- Payroll連携（接続、手動同期、給与入金先、月別手取り表示）を「口座管理」から「設定」へ移動。残高・定期入出金・NISAカード連携は口座管理に残す。
- **初回だけ** Payrollパスフレーズを入力して「次回以降も自動連携する」をオンにしたまま「連携を設定・今すぐ同期」を押す。給与ファイルの復号・検証に成功してから自動連携情報を保存。
- 自動連携に同意した場合だけ、Payrollパスフレーズを Finance の既存 AES-256-GCM 暗号化資産設定 `finance/settings/assets.enc` に格納。平文パスフレーズを localStorage、IndexedDB、sessionStorage、URL、ログ、Cookie、非暗号ファイルには書かない。Financeの復号鍵で保護されるため、Finance保管庫を開ける人にはPayrollへの復号権限も生じる。**PayrollのパスフレーズはFinanceで保護される機密情報になる。** 共有端末の場合は自動連携をオフにして利用する。
- Financeロック解除後（通常入力、タブ内一時鍵での再解除）の自動同期に対応。最新クラウド取得後・10分おきの表示中の再同期にも対応。自動同期ではPayrollへの書き込みを行わない。
- 「自動連携を解除」は暗号化資産設定の連携パスフレーズを `null` に更新し、端末の同期済み給与・一時鍵を破棄。OneDriveの**過去の暗号化ファイル世代やバージョン履歴**は削除せず、その履歴に以前の暗号化設定が残る可能性がある。
- Payrollパスフレーズ変更や同期失敗の場合は、古い手取り実績を使った残高予測を継続せず未同期に戻す。設定画面でパスフレーズを再入力して復旧する。
- 給与の入金先、暗号化形式、Graph APIの保存先・権限、PayrollのPDF・内部明細には変更なし。既存の `finance-assets-v1` 形式を維持し、旧版には新フィールドがなくても復号できる。
- 同じ設定ファイルを旧Finance版から更新すると自動連携設定が消失する可能性があるので、Mac/Galaxyを両方更新すること。

## Macへの適用

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v134-payroll-autolink-patch.zip -d ~/Documents/finance
npm run check
npm run test
npm run verify:cloud
```

ローカルプレビュー: `python3 -m http.server 5173 --directory dist`、ブラウザは `⌘ + Shift + R`。

## 検証
- `npm run check`：成功
- `npm run test`：188/188 件成功（既存テストを維持し、自動連携設定・暗号化・3方向マージ・解除・鍵変更テストを追加）
- `npm run verify:cloud`：成功（MSALバンドルの存在確認）
- PC・Galaxy幅のHTML/CSS静的検査：320/390/768/1280/1440px、横スクロールなし
- 実ブラウザのローカルURLアクセス：実行環境の管理制限によってブロック。実アプリE2E操作と実Microsoft Graph通信はユーザーMacで要確認
- この検証環境には依存ライブラリがなく、MSAL/PDF.jsのベンダーバンドルはアップロード元から同梱した既存生成物を維持。FinanceソースのTypeScriptは再コンパイル済み。ユーザーのMacで `npm run test` 実行時は依存があれば同梱MSAL等も再生成される。
