# Finance v0.8.1 hotfix

対象: Finance v0.8

## 修正
- 明細の表示時に `renderSummary()` が `render()` を呼び出し無限再帰する問題を修正
- STEP 02: 明細はそれぞれ別行で表示。クリックで STEP 03 に1件の内容を表示
- 再発防止テストを1件追加（合計18件）
- パーサー、暗号化保存、原本保存、一括取込の仕様は変更なし

## 適用
```bash
cd ~/Documents/finance
unzip -o ~/Downloads/finance-v081-hotfix.zip -d ~/Documents/finance
npm run check
npm run test
```
Pythonサーバーが稼働していればブラウザで強制再読み込み。停止中なら `python3 -m http.server 5173 --directory dist`。

## 留意
- 端末でブラウザ操作テストは未実施（この環境のブラウザはローカルサイトへのアクセスを拒否）。自動テストは18件成功。
- v0.8で保存済みのデータがある場合、ブラウザデータは消さずにそのまま適用してください。
