# Finance v1.3.3 口座管理画面の分離とUI修正

## 変更点
- 「口座管理」をサイドメニューに追加。楽天銀行・現金貯金専用口座・NISA口座、残高履歴、NISAカード積立連携、Payroll給与連携、定期入出金をこちらへ移設。
- 「設定」はOneDrive接続・暗号化パスフレーズ・接続保守の画面に限定。カテゴリー選択などの既存ダイアログはどの画面からも使える位置へ移動。
- 外観モード（端末の設定に合わせる・ライト・ダーク）をサイドメニューの一番下へ移動。従来のローカル設定キー `finance-theme` を維持。
- 口座残高履歴の展開によって、他の口座カードが伸びないようCSSの高さ揃えを解除。メイン口座・貯蓄資産のグループ分けと3口座の横並びは維持。
- 日付変更を検知して残高予測を更新する処理は新「口座管理」画面を参照するよう修正。

## 非変更点
- 既存の明細・残高・履歴・定期入出金・Payrollデータの保存構造、OneDrive保存先、暗号化形式、Graph API、計算処理は変更なし。
- リリース時には `src/`, `public/`, `dist/` を含む差分を上書き適用する。ZIPに個人データや秘密情報は含まない。

## Mac適用

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v133-account-navigation-ui-patch.zip -d ~/Documents/finance
npm run check
npm run test
npm run verify:cloud
```

ブラウザで `⌘ + Shift + R` を実行。`npm run test` は `npm run build` を含む。

## 検証
- TypeScript型チェック：成功。
- 個別のNode.js自動テスト：182件成功（既存178件＋追加4件）。
- ChromiumのローカルURLアクセスが管理ポリシーでブロックされたため、実アプリのブラウザE2Eテストは未実施。代わりに同じHTML/CSSをブラウザへ直接配置した静的レイアウト検査を320/390/980/1280/1440px幅で実施。横方向のはみ出しなし、他口座カードの高さ不変を確認。
- この環境のesbuildはmacOS用バイナリのため、`npm run build` 終端のMSAL再バンドル処理だけは実行不可。TypeScriptコンパイルと静的ファイルのdist複製は成功。既存MSALバンドルをそのまま残し、`npm run verify:cloud` は成功。
- Microsoftアカウントへの実通信は未実施。
