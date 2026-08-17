// クエリパラメータから OG 画像を PNG で返すエンドポイント。
// 描画はブラウザのプレビューと同じ app/scene.ts を通す（@napi-rs/canvas は同じ 2D API を実装している）。
// ?dl=1 を付けるとブラウザで開いたときにそのままダウンロードになる。

import { createCanvas, loadImage, GlobalFonts, type Canvas, type Image } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { BG_SOURCES, LOGO_DEFAULT, createScene, type CanvasFactory, type Images } from '../../scene';
import { ogFilename, queryToState } from '../../params';

// 描画にネイティブモジュールを使うので Node ランタイム固定
export const runtime = 'nodejs';

// ブラウザ側は canvas に "Noto Sans JP" をリテラルで指定している。サーバーでは同じ名前で
// 静的ウェイトを登録する（可変フォントは skia が weight 軸を解釈せず 1 ウェイトに潰れる）。
const FONT_FILES = ['NotoSansJP-Regular.otf', 'NotoSansJP-Medium.otf', 'NotoSansJP-Bold.otf'];
const FONT_FAMILY = 'Noto Sans JP';

// 同時に来た最初のリクエストで二重登録しないよう Promise を使い回す（失敗したら次で再試行）
let fontsReady: Promise<void> | null = null;

function registerFonts() {
  fontsReady ??= (async () => {
    for (const file of FONT_FILES) {
      const full = path.join(process.cwd(), 'fonts', file);
      GlobalFonts.register(await readFile(full), FONT_FAMILY);
    }
    // フォントが無いまま描くと端末のゴシック体で焼き付いた画像を配ってしまうので、ここで落とす
    const family = GlobalFonts.families.find((f) => f.family === FONT_FAMILY);
    if (!family || family.styles.length < FONT_FILES.length) {
      throw new Error(`${FONT_FAMILY} を登録できませんでした`);
    }
  })().catch((err) => {
    fontsReady = null;
    throw err;
  });
  return fontsReady;
}

// 背景と既定ロゴはプロセス内で使い回す（リクエストごとにデコードし直さない）
const imageCache = new Map<string, Image>();

async function publicImage(webPath: string) {
  const cached = imageCache.get(webPath);
  if (cached) return cached;
  const img = await loadImage(await readFile(path.join(process.cwd(), 'public', webPath.replace(/^\//, ''))));
  imageCache.set(webPath, img);
  return img;
}

// ブラウザ側と同じく SHA-256 ハッシュ + d=404（未登録なら 404 が返る）
async function gravatar(email: string) {
  const addr = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return null;
  const hash = createHash('sha256').update(addr).digest('hex');
  try {
    const res = await fetch(`https://www.gravatar.com/avatar/${hash}?s=256&d=404`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    // 取得できなくてもアバター無しで描く（画像自体は返す）
    return null;
  }
}

// @napi-rs/canvas は DOM と同じ 2D API を持つので、scene 側の DOM 型に合わせてキャストして渡す
const canvasFactory: CanvasFactory = (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = queryToState(params);

  try {
    await registerFonts();
    const [bg, logo, avatar] = await Promise.all([
      publicImage(BG_SOURCES[state.bg]),
      state.showLogo ? publicImage(LOGO_DEFAULT) : Promise.resolve(null),
      state.email ? gravatar(state.email) : Promise.resolve(null),
    ]);

    const images: Images = {
      bgImages: { [state.bg]: bg as unknown as HTMLImageElement },
      avatarImg: avatar as unknown as HTMLImageElement | null,
      logoImg: logo as unknown as HTMLImageElement | null,
    };

    const scene = createScene(state, images, canvasFactory);
    const canvas = scene.renderToCanvas(state.scale) as unknown as Canvas;
    const png = canvas.toBuffer('image/png');

    const filename = ogFilename(state.title);
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400',
        // 日本語ファイル名は filename* 側（RFC 5987）で渡す
        'content-disposition': params.get('dl') === '1'
          ? `attachment; filename="og-image.png"; filename*=UTF-8''${encodeURIComponent(filename)}`
          : 'inline',
      },
    });
  } catch (err) {
    return new Response(`OG 画像を生成できませんでした: ${(err as Error).message}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
