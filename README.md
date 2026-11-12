# My Favorites 13

お気に入りの13曲を選んで、CDジャケット風の画像（PNG, 2048×1776）を作る静的 Web アプリ。

**非公式のファンメイドツールです。** アーティスト・所属事務所・レーベルとは関係ありません。
公式のロゴ・画像・音源は使っていません。背景・盤面・バーコード風の模様はすべてプログラムで生成しています。

## 使い方（開発）

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # dist/ に静的ファイルを出力
```

`main` に push すると `.github/workflows/deploy.yml` が GitHub Pages に公開します
（リポジトリの Settings → Pages → Source を「GitHub Actions」にしておく）。

アプリは実行時に外部へ一切アクセスしません。曲データもフォントもビルドに含まれます。

## 曲データの作り直し

`data/songs.json` は Wikipedia 日本語版「Perfumeの作品」から辿れる各作品記事の wikitext をもとに、
`scripts/build-songs.py` で生成したものです（MediaWiki API, `action=parse&prop=wikitext`）。

```bash
WIKI_CONTACT="連絡先のメールか URL" python3 scripts/build-songs.py            # キャッシュがあれば通信しない
WIKI_CONTACT="..." python3 scripts/build-songs.py --refresh                  # 取り直す（2秒に1回）
```

| ファイル | 内容 |
|---|---|
| `data/songs.json` | `{ id, title, durationSec, release, releaseType, sourceArticle }` の配列。`releaseType` は `single` / `digital-single` / `ep` / `album` / `best` / `compilation`（画面では シングル / アルバム / その他 の3つにまとめて表示） |
| `data/duplicates.txt` | 同じ曲名で収録時間が違うもの。まとめずに全部残してある |
| `data/missing.txt` | 収録時間が取れなかった曲（`durationSec: null`） |
| `data/merged.txt` | 同じ曲名・同じ収録時間なので1件にまとめたもの |
| `data/excluded.txt` | 入れなかったもの（映像特典・インストゥルメンタル・トーク音源） |
| `data/unlinked.txt` | 一覧にあるが記事が無い作品と、その扱い（表題曲のみ時間なしで収録、など） |
| `data/unparsed.txt` | 記事はあるが収録曲を取り出せなかった作品 |

Wikipedia から収録時間が取れなかった曲には、`data/manual-durations.json` に書いた時間を当てます
（Wikipedia 由来ではなく手入力の値。取得できた時間は上書きしません）。

重複のうち不要な方を外すには、`data/exclude-ids.txt` に id を1行ずつ書いて再実行します（通信なし）。

## テスト

```bash
npm run build && npm run test:e2e
```

Playwright で実ブラウザを動かし、13曲ちょうどでしか出力できないこと、最長の曲名・名前・タイトルでも
文字がラベルからはみ出さないこと、フォント読み込み後に描画していること、リロード後の復元、
スマホ幅での操作を確認します。Playwright はこのプロジェクトの依存に入れていないので、
手元で動かす場合は `npm i -D playwright && npx playwright install chromium` が必要です。

## ライセンス・出典

- 曲名・収録時間: Wikipedia 日本語版の各作品記事（CC BY-SA 4.0）
- フォント: M PLUS 1 Code（SIL Open Font License 1.1）
- SortableJS（MIT）
