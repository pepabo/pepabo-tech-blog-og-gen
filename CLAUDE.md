# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

テックブログ用 1200×630 OG 画像ジェネレータ（Next.js App Router / TypeScript）。
レイアウトの寸法、ロゴの配置基準、背景画像・既定ロゴの作り直し手順、Gravatar の仕様は
`README.md` に詳しく書いてあるので、そのあたりを触るときは先に読むこと。

## コマンド

```bash
npm run dev              # http://localhost:3000
npm run build
npm run lint             # eslint (eslint-config-next)
curl -o /tmp/og.png 'http://localhost:3000/api/og?title=test&author=me'   # URL からの生成を確認
npx lolipop deploy       # デプロイ（.lolipop/project.json で link 済み、引数不要）
```

テストは無い。

`next.config.ts` が `output: 'standalone'` なので **`npm start`（`next start`）は使えない**。
ビルド成果物を確認するときは standalone サーバーを直接起動する:

```bash
npm run build
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
PORT=3000 node .next/standalone/server.js
```

Gravatar のハッシュ計算に `crypto.subtle` を使うため、確認は `localhost` / `127.0.0.1` か https で開く
（LAN の生 IP + http だとセキュアコンテキストにならず動かない）。

## 構造

描画コードは `app/scene.ts` に置き、**ブラウザ（プレビュー・書き出し）と `/api/og`（サーバー描画）で
同じものを通す**。`app/OgImageGenerator.tsx`（`'use client'`）がフォームとプレビュー、
`app/api/og/route.ts` が URL からの PNG 生成、`app/params.ts` がクエリパラメータ ↔ `State` の変換。
`app/page.tsx` はヘッダーだけ、`app/layout.tsx` は Google Fonts の `<link>` を置くだけ。

canvas への描画は React 化せず、単一 HTML 版のクロージャをそのまま
`createScene(state, images, createCanvas)` に移した命令的コードになっている。この境界が全体の設計の要:

- フォーム値は `useState`（`State` 型）→ そのまま `createScene` に渡す
- 画像（背景・アバター・ロゴ）は `imagesRef` に持つ。**再レンダリングのトリガにならない**ので、
  読み込めたら `bumpImages()` で `imageVersion` を進めて描画側に伝える
- プレビューも書き出しも同じ `render()` を通る。書き出しは `ctx.scale()` したオフスクリーン
  canvas に再描画するので 2x でもベクタ品質になる
- `scene.ts` は `document` を触らない（canvas の生成だけ `CanvasFactory` で受け取る）。
  型は DOM のものを使い、サーバー側（`@napi-rs/canvas`）は route 側でキャストして渡している

**画像アップロードの口は持たない**（意図的に外した）。素材は `public/` の固定ファイルと Gravatar だけ
なので、`State` が丸ごとクエリパラメータで表現でき、フォームと `/api/og` の結果が一致する。
ファイル選択を足すとこの不変条件が壊れる（`onCopyUrl` に「URL には載りません」の但し書きが必要になる）。

例外が1つだけある: Gravatar 取得後にメールアドレスを空にすると、プレビューにはアバターが残るが
`/api/og` は描かない（`applyGravatar` は失敗時にアバターを差し替えない）。消すには
「アバターをリセット」を押す。ここを自動クリアにすれば不変条件は完全になる。

## 壊れやすいところ

いずれも「見た目は動いているように見えるが結果が壊れる」類なので注意。

- **`next/font` を導入しない。** canvas 側は `ctx.font` / `document.fonts.load` にリテラルの
  ファミリ名 `"Noto Sans JP"` を渡している。`next/font` はハッシュ名にリネームするため、
  指定が効かず端末のゴシック体で焼き付く
- **`document.fonts.load(spec, 実際に描く文字列)` を描画前に通す。** 日本語はサブセット配信なので、
  怠るとフォールバックフォントで焼き付く（`ensureFonts()`）
- **`output: 'standalone'` を外さない。** ロリポップ！デプロイナウがこれを前提にしている
- **他オリジンの画像には `crossOrigin = 'anonymous'` が必須。** 付けずに canvas に描くと汚染されて
  `toBlob()` が失敗し書き出せなくなる。逆に `public/` 配下（同一オリジン）には付けない
- **`window` / `document` / `localStorage` はトップレベルで触らない。** standalone はサーバーで
  レンダリングするので `next build` が落ちる。localStorage の復元も画像の読み込みも `useEffect` 内で行う
- **サーバー側のフォントに可変フォントを使わない。** `fonts/NotoSansJP-{Regular,Medium,Bold}.otf`
  を `"Noto Sans JP"` の別名で登録している。可変フォント1本にすると skia が `wght` 軸を解釈せず、
  `ctx.font` の太さ指定が全部同じになる
- **`fonts/` と `public/` は `next.config.ts` の `outputFileTracingIncludes` に入れておく。**
  `fs` で読むファイルは追跡されないので、抜けると standalone で `/api/og` が 500 になる
- **`/api/og` に任意の画像 URL を受け取るパラメータを足さない。** サーバーが任意の宛先に
  取りに行けてしまう（SSRF）。URL から使える画像は Gravatar と `public/` の既定画像だけ
- `next dev` を別ホスト名（LAN の IP など）で開くと `/_next/static/*` がブロックされて 503 になり、
  ハイドレーションが失敗して canvas が真っ白になる。`localhost` で開く

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
