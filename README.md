# OG Image Generator

テックブログ用の 1200×630 OG 画像を作る Next.js アプリ。
描画はすべてブラウザ内の canvas で完結し、入力した画像が外部に送信されることはない
（Gravatar を使うときだけ gravatar.com にリクエストする）。

もとは単一 HTML アプリ（`og-image-generator.html`）で、そこから 1:1 で移植したもの。

## ファイル

| ファイル | 役割 |
|---|---|
| `app/page.tsx` | ヘッダーだけのサーバーコンポーネント |
| `app/OgImageGenerator.tsx` | **本体。** フォーム・canvas 描画・書き出しの全部（`'use client'`） |
| `app/layout.tsx` | Google Fonts の `<link>` を置くルートレイアウト |
| `app/globals.css` | 画面のスタイル（canvas の中身とは無関係） |
| `public/bg/p{1,2,3}.png` | 背景 1200×630 |
| `public/logo-default.png` | 既定ロゴ。GMOペパボ / Pepabo Tech Portal の文字ロックアップ透過 PNG（1202×81） |

## レイアウト

レイアウトは白カード1種類のみ（選択UIなし）。背景に暗くするオーバーレイは掛けない。

```
1200x630
┌────────────────────────────┐
│┌──────────────────────────┐│ ← 背景は四辺 44px の額縁として見える
││                          ││
││ タイトル (自動サイズ)       ││
││                          ││
││ (o) 著者名                ││
││     所属                  ││
││                          ││
││                  【ロゴ】  ││ ← カード右下角に絶対位置で固定
│└──────────────────────────┘│
└────────────────────────────┘
```

- カード: `CARD_MARGIN = 44` の余白を残した 1112×542、角丸 26
- 内側余白: `CARD_PAD = 56` → 本文左端は x=100、本文右端は x=1100
- ロゴ: カード右下角に固定。**本文の量に影響されず常に同じ位置**
  - 右マージン `CARD_PAD = 56` / 下マージン `LOGO_PAD_BOTTOM = 48`。下の余白はカード幅いっぱいの
    帯として見えるぶん広く感じるため、意図的に詰めている（数値を揃えると下が広く見える）
  - 下マージンの起点は画像の外接矩形ではなく「右端15%の帯のインク下端」（`logoBottomInsetRatio`）。
    既定ロゴは左の GMO 部分が上下いっぱいなのに対し右の文字列は下に 16/81 の余白があるので、
    外接矩形で揃えると角に接する文字の下マージンだけ 4.5px 広くなる。実行時にアルファを
    走査しているので、別のロゴを差し替えても同じ基準で揃う
- タイトル＋著者: ロゴに掛からない範囲（上端 y=132 〜 ロゴ上端-28）で光学的中心に置く

## 既定ロゴの作り直し

<https://tech.pepabo.com/images/eyecatch-placeholder.png>（ペパボンと文字が縦に並んだ白背景 PNG）の、
**下部の文字ロックアップだけ**を切り出して透過にしたもの。ペパボン（吹き出しマーク）は入れない。

```bash
curl -sfL -o eyecatch-placeholder.png https://tech.pepabo.com/images/eyecatch-placeholder.png

magick eyecatch-placeholder.png -crop 1920x260+0+820 +repage \
  -fuzz 12% -transparent white -trim +repage -strip public/logo-default.png   # 1202x81
```

`-crop` の開始 y=820 はペパボンの尻尾を巻き込まない位置。ここを 720 にすると尻尾の先端が
外接矩形に入って上に余白ができる。

白の抜きは `-fuzz 12% -transparent white`。輝度をアルファに流す手法だと青と濃灰の2色が
それぞれ別の不透明度になって色が変わるため使わない。

## アバターと Gravatar

アバターはメールアドレス入力か画像ファイルのどちらでも指定できる（最後に操作したほうが有効）。

- ハッシュは **SHA-256**。Gravatar は MD5 / SHA-256 のどちらも受け付けるので、ブラウザ標準の
  `crypto.subtle.digest` で計算できる SHA-256 を使い、MD5 実装を持ち込まない
- `crypto.subtle` はセキュアコンテキスト限定。`https` / `localhost` では動くが、
  LAN の生 IP + http では使えないので、その旨をメッセージで出す
- URL は `https://www.gravatar.com/avatar/<sha256>?s=256&d=404`。`d=404` により未登録時は
  404 が返り、`img.onerror` で判別できる
- **`crossOrigin = 'anonymous'` は必須**。これを付けずに他オリジンの画像を canvas に描くと
  canvas が汚染され、`toBlob()` が失敗して書き出しができなくなる。Gravatar は
  `access-control-allow-origin: *` を返すのでこれで通る。逆に `public/` 配下の画像は
  同一オリジンなので `crossOrigin` は付けない
- 入力欄は 500ms デバウンス。応答が前後しても古い結果で上書きしないようトークンで判定する

メールアドレスは localStorage に保存する（次回開いたときに再取得する）。外部に送られるのは
ハッシュだけで、アドレスそのものは送信しない。

## 開発

```bash
npm install
npm run dev      # http://localhost:3000
```

背景画像の差し替えは `public/bg/p{1,2,3}.png`（1200×630）を置き換えるだけ。
元データは社内の Google Slides のレイアウト背景を書き出したもの。

```bash
# 自前の画像を 1200x630 にリサイズする場合
magick in.png -resize 1200x630^ -gravity center -extent 1200x630 out.png
```

## ビルドと動作確認

```bash
npm run build
```

`next.config.ts` で `output: 'standalone'` を指定しているため、`next start` は使えない
（起動はするが警告が出る）。ビルド成果物で確認するときは standalone サーバーを直接叩く:

```bash
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
PORT=3000 node .next/standalone/server.js
```

`crypto.subtle`（Gravatar のハッシュ計算）はセキュアコンテキストでしか動かないので、
確認は `localhost` / `127.0.0.1` か https で開くこと。

## デプロイ

ロリポップ！デプロイナウにデプロイする。

```bash
npx lolipop deploy --name <name> --framework next
```

## 実装メモ

- **フォント**: Noto Sans JP を Google Fonts から `<link>` で読み込む。**`next/font` は使わない。**
  `next/font` はファミリ名を `__Noto_Sans_JP_xxxx` のようなハッシュ名にリネームするが、canvas 側は
  `ctx.font = '700 48px "Noto Sans JP"'` / `document.fonts.load('700 48px "Noto Sans JP"', 文字列)` と
  リテラルのファミリ名で指定しているため、リネームされると指定が効かず端末のゴシック体で焼き付く
  （見た目は動いているように見えるので気づきにくい）
- **サブセット**: 日本語はサブセット配信されるため `document.fonts.load(spec, 実際に使う文字列)` に
  本文を渡してから描画する。これを怠ると canvas がフォールバックフォントで焼き付いてしまう。
  オフライン時は端末のゴシック体になる
- **SSR**: `output: 'standalone'` はサーバーでレンダリングするので、`window` / `document` /
  `localStorage` にトップレベルで触ると `next build` が落ちる。localStorage の復元も画像の
  読み込みも `useEffect` の中でしか行わない
- **禁則処理**: 行頭に句読点・閉じ括弧が来ないよう、また英単語が途中で切れないよう
  `tokenize()` + `wrapLine()` で処理している
- **文字サイズの自動調整**: まず「手で入れた改行をそのまま保てる最大サイズ」を 54→34px で探し、
  それで収まらなければ自動折り返しを許して 54→24px で探す。4行を超える場合は警告を出す
- **書き出し**: `ctx.scale()` を使ったオフスクリーン canvas に再描画するので、
  2x（2400×1260）でも文字・図形がベクタ品質で出る
- **React との境界**: 命令的な描画コードは React 化せず、単一 HTML 版のクロージャをそのまま
  `createScene(state, images)` に移した。フォーム値だけ `useState`、画像は `useRef` に持ち、
  差し替えたことは `imageVersion` カウンタで描画側に伝える
- **入力の保存**: 著者名・所属・メールアドレス・背景の選択は localStorage に保存する。タイトルは保存しない
