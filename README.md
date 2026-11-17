> **最新：Finance v1.3.3** 口座管理を独立メニューへ移設。定期入出金・給与連携も口座管理に集約し、残高履歴展開時の隣接カード伸縮を解消。外観モードはサイドバー下部へ戻しました。詳細は [README-v133.md](README-v133.md)。

> **最新：Finance v1.3.0** 設定画面の統合、3口座の自動残高予測とNISAカード明細連携を追加。対応内容と制限は [README-v130.md](README-v130.md) を参照してください。

> **最新：Finance v1.2.8** Microsoft Graphのフォルダ情報JSONが不正な場合、読み取り専用の代替経路で復旧する処理を追加。詳細は [README-v128.md](README-v128.md)。

# Finance v1.2.1 | OneDrive暗号化カード明細管理

Financeは、楽天・JCB・ビュー・三井住友・Amazon・GOLD POINT CARD+などの**カード請求明細を解析し、暗号化してOneDriveへ保存する個人用Webアプリ**です。HTML / CSS / TypeScriptで動き、サーバー側で平文の金融データを処理しません。

> **v1.0.0から更新する人へ：** 変更内容・自動移行・保存先構造・注意事項は [`README-v110.md`](./README-v110.md) を先に確認してください。

> **v0.9.4から更新する人へ：** 初期設定、旧IndexedDBの移行、保存方式、競合処理、注意事項は [`README-v100.md`](./README-v100.md) を参照してください。既存のIndexedDBは勝手に削除しません。

## 起動・チェック（Mac）

```bash
cd ~/Documents/finance
npm install
npm run check
npm run test
npm run verify:cloud
python3 -m http.server 5173 --directory dist
```

`http://localhost:5173/`を開きます。Microsoft Entraのアプリ登録にはこのURIを「SPA」として登録し、委任されたアクセス許可`Files.ReadWrite.AppFolder`を付与してください。公開したHTTPSのGitHub Pagesからも利用する場合、対応するリダイレクトURIを追加登録します。

## 使い方

1. MicrosoftアカウントでOneDriveに接続します。保管庫が存在すればパスフレーズで復号し、初回なら新規作成します。パスフレーズは1Passwordなどに保存してください。
2. 「明細インポート」でPDFを読み込むか、Web明細をコピー＆ペーストして解析します。画像化PDFのOCRはありません。
3. 解析結果を照合します。取引や請求総額の不備は「明細の管理」から修正します。
4. 新規明細は一括取り込みボタンで暗号化保存します。保存済み明細の編集はフィールド確定後にOneDriveへ自動反映され、管理画面の保存ボタンでも明示的に保存できます。
5. 保存済み明細の削除もOneDriveの暗号化インデックスへ反映されます。原本PDFは誤削除防止のため暗号化ファイルを残します。
6. 「利用先ルール」で元の利用先表記から表示名への置換ルールを登録できます。保存済み明細から利用先名を選ぶモーダル、カテゴリー設定、12色パレットも利用可能です。過去・未来の明細に適用され、明細管理からも「ルール化」できます。
7. 別端末からも同じMicrosoftアカウントでログインし、同じパスフレーズを入力します。画面に戻った場合または「最新データを取得」で他端末の変更を再読込します。

## 保存と暗号化

- **正本：OneDrive**。資産残高・定期入出金は`finance/settings/assets.enc`に分離して保存。解析結果は`finance/statements/YYYY.enc`、PDF原本は`finance/originals/YYYY/MM/UUID.enc`、暗号化索引は`finance/index.enc`、利用先ルールは`finance/rules/merchants.enc`にそれぞれ分離して保存。
- AES-256-GCM、PBKDF2-SHA256（310,000回）、個別IV。パスフレーズと導出鍵はタブのメモリのみ。
- OneDriveのETagを使って他端末の更新競合を検知し、行ID・項目単位の3方向マージで統合。衝突した値は暗号化監査履歴に残します。
- 通信失敗の場合「保存済み」にせず、ブラウザに開いている間は変更を保持します。**未保存のままタブを閉じないでください。**
- IndexedDBは旧バージョンの移行操作を選択した場合にだけ使用。新しい明細やPDFはIndexedDBへ保存しません。
- 0.9.4のOneDriveスナップショットはそのまま保管され、新しいライブ保管庫と別管理になります。独立した履歴閲覧/復旧UIは今後実装予定。

## 構成

```text
public/index.html                      アプリ画面
public/styles/style.css                共通CSS、ライト/ダークモード
src/main.ts                            取込画面、管理画面、保存操作
src/importers/                          カード明細の解析・検証
src/ui/                                 共有UIと入力操作
src/cloud/cloud-settings.ts            Microsoft認証・クラウド画面
src/cloud/onedrive-api.ts              Graph API / アップロードセッション
src/cloud/cloud-crypto.ts              AES-GCM暗号化と復号
src/cloud/layout.ts                    Finance/Payrollの共有名前空間と年月別保存規約
src/cloud/live-vault.ts                OneDrive正本、条件付き更新と自動マージ
src/cloud/merge.ts                     レコード/行/フィールドの3方向マージ
src/cloud/asset-projection.ts           口座の残高予測（定期入出金・カード積立）
src/cloud/assets.ts                     口座・残高履歴・定期入出金データと競合マージ
src/ui/assets-settings.ts               口座管理画面
src/cloud/merchant-rules.ts            利用先ルール、カテゴリー/色、表示名の解決、競合マージ
src/ui/recent-merchants.ts             保存済み明細から最近の元の利用先を抽出
src/storage/encrypted-vault.ts         旧IndexedDB移行処理専用
scripts/                               ビルド処理
tests/                                 解析、暗号化、Graph、競合テスト
```

## 注意

Financial data should never be committed to GitHub. PDF原本や利用明細、復号パスフレーズをリポジトリに追加しないでください。ブラウザでの解析・暗号化のみを行い、ユーザーデータはOneDriveの専用領域へ送ります。使用前に実際のOneDrive保存・再読み込み・別端末復号を少量のデータで確認してください。

## v1.1.1の変更

OneDriveのフォルダIDキャッシュ、年別データの並列取得、ETagを使った変更なしファイルの再利用、アップロード完了ETagの再利用によって通信回数を削減しました。詳しくは `README-v111.md` を参照してください。


## v1.1.2 操作結果表示とタブ内復号

保存・削除の結果を画面上に継続表示します。復号ダイアログの「このタブでは再読み込み後も解除状態を維持」は既定オフの任意設定です。詳細は `README-v112.md` を参照してください。

## v1.1.3 UI整理（取込・年月・OneDrive）

- 明細インポートは今回の取込待ちの明細だけ表示し、OneDriveへ保存完了した項目は一覧・プレビューから外します。保存済み明細は「明細の管理」で扱います。下書きを破棄してもクラウド上の保存済み明細は消しません。
- 明細の管理はブラウザの現在年月を初期選択します。その年月に明細がなくても該当年月を選択したままにし、ユーザーが「すべての年」「すべての月」を選び直せます。
- OneDriveは接続状態、最新取得、ロック、サインアウトを主要画面に集約。Client ID設定、フォルダ接続確認、旧IndexedDB移行、暗号化テストは折りたたみメニューへ移しました。Client ID未登録の場合は設定欄を最初から展開します。

詳細と適用方法は `README-v113.md` に記載。暗号化、クラウドの保存ファイル形式、Microsoft Graphの権限は変更していません。

## v1.2.0の変更

利用先ルール画面、OneDrive上の暗号化された独立ルールファイル、明細管理からのルール登録、元表記と個別表示名の分離を追加しました。詳細は `README-v120.md` を参照してください。

## v1.2.1の変更

利用先履歴選択モーダル、カテゴリー割当、カテゴリーごとの12色固定パレットを追加。詳細は `README-v121.md` を参照してください。

## v1.2.4の変更

楽天銀行・現金貯金専用口座・NISA口座の残高と確認日時の履歴、および定期入出金（毎月・毎年・毎週、支出・収入・口座間振替）の登録・編集・削除を実装しました。データは独立した暗号化ファイルへ即時反映し、ETag・3方向マージに対応します。現在の段階では各種の残高予測やNISAのカード積立・Payroll連携は行いません。詳細は `README-v124.md` を参照してください。
