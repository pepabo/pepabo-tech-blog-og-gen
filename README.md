# OG Image Generator

テックブログ用の 1200×630 OG 画像を作る Next.js アプリ。使い方は2通り。

- **フォーム（`/`）**: 描画はすべてブラウザ内の canvas で完結する
  （Gravatar を使うときだけ gravatar.com にリクエストする）
- **URL（`/api/og?…`）**: クエリパラメータからサーバー側で同じ画像を生成して PNG を返す。
  `<img>` や curl からそのまま取れる。詳細は「[URL から生成する](#url-から生成する)」

素材は**リポジトリに入っているものだけ**を使う。背景は `public/bg/p{1,2,3}.png` の3枚、ロゴは
`public/logo-default.png`、アバターは Gravatar。画像アップロードの口は持たない。おかげでフォームの
`State` は丸ごとクエリパラメータで表現でき、**フォームの内容と `/api/og` の生成結果が一致する**
（唯一の例外は「[アバターと Gravatar](#アバターと-gravatar)」の残留アバター）。

もとは単一 HTML アプリ（`og-image-generator.html`）で、そこから 1:1 で移植したもの。

## ファイル

| ファイル | 役割 |
|---|---|
| `app/page.tsx` | ヘッダーだけのサーバーコンポーネント |
| `app/OgImageGenerator.tsx` | フォーム・プレビュー・書き出し（`'use client'`） |
| `app/scene.ts` | **描画の本体。** ブラウザと `/api/og` で共有する canvas 描画コード |
| `app/params.ts` | クエリパラメータ ↔ `State` の変換 |
| `app/api/og/route.ts` | URL から PNG を返すエンドポイント（Node ランタイム） |
| `app/layout.tsx` | Google Fonts の `<link>` を置くルートレイアウト |
| `app/globals.css` | 画面のスタイル（canvas の中身とは無関係） |
| `public/bg/p{1,2,3}.png` | 背景 1200×630 |
| `public/logo-default.png` | 既定ロゴ。GMOペパボ / Pepabo Tech Portal の文字ロックアップ透過 PNG（1202×81） |
| `fonts/NotoSansJP-*.otf` | サーバー描画用の Noto Sans JP（OFL 1.1・`fonts/LICENSE.txt`） |

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

アバターの指定手段は Gravatar だけ（メールアドレスを入れる）。未登録のアドレスならアバター無しで描く。
取得済みのアバターはメールアドレスを消しただけでは消えないので、「アバターをリセット」ボタンで落とす。

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
- **取得に失敗してもアバターは差し替えない**（前のものが残る）。この状態でメールアドレスを空にすると
  プレビューにはアバターが残るが `/api/og` は描かないので、両者がずれる唯一のケースになる。
  気になるなら「アバターをリセット」を押す

メールアドレスは localStorage に保存する（次回開いたときに再取得する）。外部に送られるのは
ハッシュだけで、アドレスそのものは送信しない。

## URL から生成する

`/api/og` にクエリパラメータを渡すと、フォームと同じ絵をサーバー側で描いて PNG を返す。
フォームの「画像URLをコピー」ボタンで、いまの入力内容の URL が作れる。

```
https://tech-blog-og-gen.lolipop-now.app/og.png?title=記事のタイトル%0A2行目&author=山田 太郎&role=技術部&email=you@example.com&bg=p2
```

`/og.png` は `/api/og` への rewrite（`next.config.ts`）。Slack や X のリンク展開は
content-type ではなく拡張子を見ていることがあるので、貼り付け用にはこちらを使う。
`dl=1` を付けたものは `Content-Disposition: attachment` になるので展開されない。

| パラメータ | 値 | 既定 |
|---|---|---|
| `title` | タイトル。`%0A`（改行）で明示的に折り返す。300文字で切る | 空（プレースホルダを描く） |
| `author` | 著者名。120文字で切る | 空 |
| `role` | 所属・肩書き。120文字で切る | 空 |
| `email` | Gravatar を引くメールアドレス | 空（アバターなし） |
| `bg` | `p1` / `p2` / `p3`。それ以外は `p1` に落とす | `p1` |
| `logo` | `0` でロゴを消す | 表示する |
| `size` | タイトルの文字サイズ 24〜60。**渡すと自動調整が切れる** | 自動調整 |
| `scale` | `2` で 2400×1260 | `1`（1200×630） |
| `dl` | `1` で `Content-Disposition: attachment`（開くとそのまま保存） | `inline` |

- **`email=` は URL に生のアドレスが残る。** ブラウザのフォームは SHA-256 ハッシュしか外に出さないが、
  この URL をブログの `og:image` などに貼るとページのソースにアドレスが載る
- **任意の画像 URL を受け取るパラメータを足さない。** サーバーが任意の宛先に取りに行けてしまう
  （SSRF）。画像は Gravatar と `public/` 配下の固定素材だけに限る
- レスポンスは `Cache-Control: public, max-age=86400`
- 描画コードは `app/scene.ts` をブラウザと共有していて、レイアウトの計算結果は一致する。
  ラスタライズ（文字とロゴの輪郭）だけプレビューと微妙に違う

### サーバー側のフォント

ブラウザは Google Fonts（可変フォント由来のサブセット）を使うが、サーバーは `fonts/` に置いた
**静的ウェイトの OTF 3本**（Regular / Medium / Bold）を `"Noto Sans JP"` の別名で登録する。

- **可変フォント（`NotoSansJP[wght].ttf`）は使えない。** skia が `wght` 軸を解釈せず 1ウェイトに
  潰れるため、`ctx.font` の `400` / `500` / `700` がすべて同じ太さで焼き付く（実測で確認済み）
- 文字幅はブラウザと最大 0.15% 差（純粋な日本語は完全一致）。折り返し判定が変わるのは
  行が上限幅の 2px 以内に収まっている場合だけ
- フォントが登録できなければ 500 を返す。端末のゴシック体で焼き付いた画像を配らないため

```bash
# 取り直す場合（noto-cjk の JP サブセット OTF）
for w in Regular Medium Bold; do
  curl -sfL -o "fonts/NotoSansJP-$w.otf" \
    "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/JP/NotoSansJP-$w.otf"
done
```

## 開発

```bash
npm install
npm run dev      # http://localhost:3000
```

`next dev` は別ホスト名からの `/_next/static/*` を既定でブロックする（503 になりハイドレーションが
失敗して canvas が真っ白になる）。`localhost` で開くこと。

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

`/api/og` は `process.cwd()` から `fonts/` と `public/` を読む。standalone 出力には
`outputFileTracingIncludes`（`next.config.ts`）で入れているので、`.next/standalone` を
カレントディレクトリにして起動しても動く。

## デプロイ

ロリポップ！デプロイナウで公開している。

| 項目 | 値 |
|---|---|
| 公開URL | https://tech-blog-og-gen.lolipop-now.app |
| プロジェクト名 | `pepabo-tech-blog-og-gen` |

`.lolipop/project.json` があれば、更新は引数なしで通る（`.gitignore` 対象なので、このチェックアウトには含まれない）。

```bash
npx lolipop deploy
```

ビルドはサーバ側で走る。キューに入ってから公開まで3分ほどかかる。

### 注意

- **`output: 'standalone'` は必須**。これが無いとデプロイ成果物を組み立てられない
- `/api/og` は `@napi-rs/canvas`（ネイティブモジュール）を使うので `serverExternalPackages` に
  入れてバンドルさせない。プラットフォーム別のバイナリ（`@napi-rs/canvas-linux-x64-gnu`）は
  サーバ側の `npm install` で入る
- **`fonts/` と `public/` は `outputFileTracingIncludes` に書いておく。** `fs` で読むファイルは
  コード解析で追跡されないため、書き忘れると standalone 出力に入らず `/api/og` が 500 になる
- サブドメインに `pepabo` を含む名前は予約済みで弾かれる。そのためプロジェクト名
  (`pepabo-tech-blog-og-gen`) とサブドメイン (`tech-blog-og-gen`) を `--domain` で分けている
- 新規作成からやり直す場合:
  `npx lolipop deploy --name <name> --framework next --domain <subdomain>`

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
  `createScene(state, images, createCanvas)` に移した。フォーム値だけ `useState`、画像は `useRef` に持ち、
  読み込めたことは `imageVersion` カウンタで描画側に伝える（背景のプリロードと Gravatar が非同期なため、
  アップロードが無くなってもこの仕組みは要る）
- **入力の保存**: 著者名・所属・メールアドレス・背景の選択は localStorage に保存する。タイトルは保存しない
