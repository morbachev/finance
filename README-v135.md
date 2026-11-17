# Finance v1.3.5 設定画面の簡素化

v1.3.4へ上書きする差分パッチです。保存データ、暗号化形式、Payroll自動同期の周期・鍵管理・残高予測は変更しません。

- Payrollの同期に成功すると表示される詳細欄を、初期状態が閉じたネイティブアコーディオン（`details` / `summary`）へ変更。
- 設定画面から給与総手取りと月別給与額を撤去。詳細を開くと同期件数・最終同期日時・支給月ごとの件数だけを確認可能。収入金額は計算内部には保持し、銀行残高の予測には従来どおり反映。
- 暗号化パスフレーズ変更欄から「変更にはMicrosoftアカウントへの接続と保管庫のロック解除が必要です。」の初期案内を削除。変更結果やエラーがある場合は従来どおり表示。

## Mac適用方法

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v135-payroll-settings-compact-patch.zip -d ~/Documents/finance
npm run check
npm run test
npm run verify:cloud
```

実際のMicrosoft Graph通信の確認はMacで行ってください。
