# Finance v1.2.8 | OneDriveフォルダ情報JSON異常への耐性強化

## 発見した事象

- パスフレーズ変更後、新しい暗号化世代の索引は正常に復号できる一方、年別明細の一覧でJSON構文エラー。
- HTTP 200、Content-Type `application/json` のフォルダ名 `versions` のGraph応答が最後に確認された。
- 現時点ではGraph応答本文の検証が未実施であり、サーバー応答の破損自体は断定できない。

## 変更内容

- `src/cloud/onedrive-api.ts` のフォルダ解決で、直接パス参照がHTTP 200を返してもJSON構文不正なら、親フォルダの `children` 一覧で同名のフォルダIDを安全に探す。
- 代替参照はGETのみ。同名のファイルとフォルダを区別し、一覧が200件を超えて不完全なら推測せず失敗として報告。
- 直接参照と代替参照の両方が解釈不能なら、機密情報を含まないエラーメッセージを返す。
- 保管庫形式、暗号化方式、OneDrive保存パス、旧データは変更しない。

## 適用と検証

このZIPはv1.2.7に適用する差分パッチ。適用後はブラウザを強制再読み込み。

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v128-graph-folder-recovery-patch.zip -d ~/Documents/finance
npm run check
npm run test
npm run verify:cloud
```

まずOneDrive画面の**読み取り専用診断**を再実行し、年別明細一覧に進めるか確認する。現段階ではデータの再保存・旧世代削除・パスフレーズ変更を行わない。

## セキュリティ

- 開発者ツールの `Authorization: Bearer ...` は機密のアクセストークン。送信・保存・共有しない。すでに共有した場合はMicrosoftアカウントの全端末サインアウトなどでセッションを無効化する。
- このパッチはMicrosoft Graphの本番環境で未検証。端末側での確認が必要。
