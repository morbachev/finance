# Finance v0.9.4 | OneDrive 暗号化明細バックアップ / 初回端末移行

> v0.9.3に適用する差分パッチです。**自動双方向同期ではありません。** 第1段階は暗号化済み明細・PDF原本をクラウドへ保管し、別端末の**空のブラウザ**に復元する方式です。

## 実装した機能

- OneDrive接続画面の **STEP 04「明細・原本のクラウド保存」** に、暗号化バックアップの新規作成・クラウド一覧取得・ファイルのダウンロード・空のブラウザへの復元を追加。
- 既存の `finance-encrypted-backup-v1` 形式をそのまま使用。暗号化済みの取引データ・PDF原本をアップロード。**パスフレーズ、暗号鍵、平文PDF、明細の平文をOneDriveに送信しない**。
- ローカルの **IndexedDBは引き続き正式な保存先**。クラウドへ送るだけではローカルの情報は削除・変更されない。
- 保存ごとに `finance-vault-<時刻>-<乱数UUID>.enc.json` を新規作成し、既存のクラウドバックアップを上書きしない。Graphの `conflictBehavior=fail` を設定。
- バックアップが4MiBを超える場合はMicrosoft Graphのアップロードセッションを使い320KiBの整数倍のチャンクで送信（最大150MiB）。アップロード用URLに認証トークンを付与しない。
- 新しい端末で取得したデータは、**元の保管庫パスフレーズ**を入力して復号・IndexedDBへ保存する。既存の保管庫がある端末への復元は拒否。
- 「まだ保存していない取り込み結果・編集内容」があるとアップロードと復元を止める。
- 接続テスト用ファイル `finance-v09-connectivity.enc.json` はそのまま残り、実明細のバックアップとは別管理。

## Macへの適用

ダウンロードした `finance-v094-onedrive-backup.zip` を `~/Downloads/` に置きます。

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v094-onedrive-backup.zip -d ~/Documents/finance
npm install
npm run check
npm run test
npm run verify:cloud
```

Pythonサーバーの配信先は引き続き `dist/`。`http://localhost:5173/` で強制再読み込み（⌘⇧R）。GitHub Pagesにも反映するならビルド後の `dist` をデプロイしてください。MSALとPDF.jsのvendorアセットは `npm run build` が `node_modules` から生成します。

## Mac -> Galaxy で初めて開く

1. **MacのFinance** で保存済み明細を開き、現在の変更を一括保存しておく。暗号化保存領域のパスフレーズは1Passwordなどで管理しておく。
2. **OneDrive接続** でMicrosoftアカウントにログインし、アプリ専用フォルダを確認。
3. STEP 04「**現在の明細を暗号化バックアップ**」をクリック。確認ダイアログを承認。過去のバックアップを置き換えずに新規保存。
4. 別端末で使う **GalaxyのHTTPS公開版Finance** を開く。Microsoft Entraで**GalaxyからアクセスするGitHub PagesのSPAリダイレクトURI**も同じアプリに登録しておく。
5. Galaxyで同じMicrosoftアカウントのClient IDを登録、サインイン、フォルダ接続確認後、STEP 04「**一覧を更新**」。
6. 日時が最新のバックアップを選択して「**空のブラウザに復元**」。ローカルに既存の保存領域がない場合のみ実行可能。Macで使っている**保管庫のパスフレーズ**を入力する（接続テスト用のパスフレーズではありません）。
7. 復元後、明細件数・請求総額・PDF原本の有無をMacと照合する。

> Galaxyで既にFinanceの保存領域を作成済みの場合、クラウドから上書き復元できません。**IndexedDBやサイトデータを安易に消さないでください**。先に双方の暗号化バックアップを保存し、別オリジン・別ブラウザでの復元を検討してください。

## 現段階でできないこと・次の段階

- ローカル明細を保存した瞬間に自動アップロードする機能。
- 別端末での編集・削除と競合した際に、取引明細単位で自動統合する機能。
- 既存のIndexedDBに別端末のスナップショットを自動マージする機能。
- ローカル保存時にクラウドスナップショットを自動削除する機能。クラウドの履歴は蓄積するため、容量と保存数を確認してください。200件を超える場合は一覧を安全のため停止します。

これらは今後の同期フェーズで対応。現時点で「MacとGalaxyの双方で編集した場合」は自動的に統一されないので、クラウドスナップショットからの初回復元後は、それぞれで編集しながら双方向に同期されたと誤認しないでください。

## 開発環境での検証

- TypeScript 5.9 の厳格型チェック（`tsc --noEmit`）
- Node組み込みテスト45件成功（暗号化形式、Graph API模擬通信、4MiB超の分割アップロード、既存UIなど）
- Chromiumの幅1440pxと390pxで、OneDrive画面に横スクロールがないことを確認
- Microsoftアカウントを使用した**実際の金融データのアップロードと別端末復元は未検証**。本人の端末から検証してください。

## Microsoft公式仕様

- 小さいファイルのアップロード: https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0
- 大きいファイルのアップロード: https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0
- ブラウザからのダウンロード: https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0
