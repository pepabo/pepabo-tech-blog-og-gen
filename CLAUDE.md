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

実装はほぼ `app/OgImageGenerator.tsx`（`'use client'`）1ファイルに閉じている。
`app/page.tsx` はヘッダーだけ、`app/layout.tsx` は Google Fonts の `<link>` を置くだけ。

canvas への描画は React 化せず、単一 HTML 版のクロージャをそのまま `createScene(state, images)` に
移した命令的コードになっている。この境界が全体の設計の要:

- フォーム値は `useState`（`State` 型）→ そのまま `createScene` に渡す
- 画像（背景・アバター・ロゴ）は `imagesRef` に持つ。**再レンダリングのトリガにならない**ので、
  差し替えたら `bumpImages()` で `imageVersion` を進めて描画側に伝える
- プレビューも書き出しも同じ `render()` を通る。書き出しは `ctx.scale()` したオフスクリーン
  canvas に再描画するので 2x でもベクタ品質になる

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
