// canvas への描画一式。ブラウザのプレビュー・書き出しと /api/og のサーバー描画で同じコードを通す。
// そのため document を直接触らず、canvas の生成だけ呼び出し側から CanvasFactory で受け取る。
// 型は DOM のものを使い、サーバー側（@napi-rs/canvas）は互換 API をキャストして渡す。

export const W = 1200, H = 630;
export const FONT = '"Noto Sans JP", -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';

export const LOGO_DEFAULT = '/logo-default.png';

export const BG_SOURCES: Record<string, string> = {
  p1: '/bg/p1.png',
  p2: '/bg/p2.png',
  p3: '/bg/p3.png',
};

export type State = {
  title: string;
  author: string;
  role: string;
  email: string;
  bg: string;
  showLogo: boolean;
  autoSize: boolean;
  titleSize: number;
  scale: number;
};

export const INITIAL_STATE: State = {
  title: '',
  author: '',
  role: '',
  email: '',
  bg: 'p1',
  showLogo: true,
  autoSize: true,
  titleSize: 46,
  scale: 1,
};

// 画像はデコード済みのものだけを描画対象にする（描画は同期処理のため）
export type Images = {
  bgImages: Record<string, HTMLImageElement>;
  avatarImg: HTMLImageElement | null;
  logoImg: HTMLImageElement | null;
};

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

// ---------- テキスト整形 ----------

// 行頭に置けない文字（終わり括弧・句読点・小書き仮名など）
const NO_START = '、。，．・：；？！ー〜）〕］｝〉》」』】”’ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ!?,.:;)]}';
// 行末に置けない文字（始め括弧）
const NO_END = '（〔［｛〈《「『【“‘([{';
// 英数字は語の途中で折り返さないようひとまとまりにする
const WORDY = /[A-Za-z0-9@#$%&'’\-_\/.+]/;

function tokenize(str: string) {
  const out = [];
  let buf = '';
  for (const ch of str) {
    if (WORDY.test(ch)) {
      buf += ch;
    } else {
      if (buf) { out.push(buf); buf = ''; }
      out.push(ch);
    }
  }
  if (buf) out.push(buf);
  return out;
}

function wrapLine(c: CanvasRenderingContext2D, text: string, maxW: number) {
  const tokens = tokenize(text);
  const lines = [];
  let cur = '';
  for (const tok of tokens) {
    if (tok === ' ' && cur === '') continue;
    const test = cur + tok;
    if (cur !== '' && c.measureText(test).width > maxW) {
      // 行頭禁則: ぶら下げて現在行に収める
      if (tok.length === 1 && NO_START.includes(tok)) { cur = test; continue; }
      // 行末禁則: 始め括弧は次の行に送る
      let carry = '';
      const last = cur[cur.length - 1];
      if (last && NO_END.includes(last)) { carry = last; cur = cur.slice(0, -1); }
      lines.push(cur.replace(/\s+$/, ''));
      cur = carry + tok;
    } else {
      cur = test;
    }
  }
  if (cur.trim() !== '') lines.push(cur.replace(/\s+$/, ''));
  return lines.length ? lines : [''];
}

type TitleLayout = { size: number; lines: string[]; overflow: boolean; lineH: number; height: number };

// ---------- 描画ヘルパ ----------

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 領域を埋めるように中央基準で切り抜いて描画（CSS の object-fit: cover 相当）
function drawCover(c: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

const logoInsetCache = new WeakMap<HTMLImageElement, number>();

// ロゴ右端付近のインク下端が、画像の外接矩形の下端からどれだけ浮いているかを比率で返す。
// 既定ロゴは左の GMO 部分が上下いっぱいで、右の文字列だけ下に余白がある。外接矩形で
// 揃えると角に一番近い文字の下マージンだけ広く見えるため、ここを基準に補正する。
function logoBottomInsetRatio(img: HTMLImageElement, createCanvas: CanvasFactory) {
  const cached = logoInsetCache.get(img);
  if (cached !== undefined) return cached;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const band = Math.max(1, Math.round(w * 0.15));
  let ratio = 0;
  try {
    const cv = createCanvas(band, h);
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    if (!c2) throw new Error('NO_CONTEXT');
    c2.drawImage(img, w - band, 0, band, h, 0, 0, band, h);
    const { data } = c2.getImageData(0, 0, band, h);
    scan: for (let y = h - 1; y >= 0; y -= 1) {
      for (let x = 0; x < band; x += 1) {
        if (data[(y * band + x) * 4 + 3] > 24) { ratio = (h - 1 - y) / h; break scan; }
      }
    }
  } catch { /* 読めない画像は補正しない */ }
  logoInsetCache.set(img, ratio);
  return ratio;
}

// ---------- レイアウト ----------

const CARD_MARGIN = 44;   // 背景を額縁のように残す幅
const CARD_PAD = 56;      // カード内側の余白
const PAD_X = CARD_MARGIN + CARD_PAD;
// 下の余白はカード幅いっぱいの帯として見えるぶん広く感じるので、右より詰める
const LOGO_PAD_BOTTOM = 48;

const AVATAR_D = 64;
const AUTHOR_H = 68;
const AUTHOR_GAP = 44;
const LOGO_MAX_W = 340, LOGO_MAX_H = 46;

// 文字は常に白カードの上に乗るので墨色で固定する
const INK = { title: '#16181d', name: '#16181d', role: '#6b7480' };

function measureContain(img: HTMLImageElement, maxW: number, maxH: number) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.min(maxW / iw, maxH / ih);
  return { w: iw * s, h: ih * s };
}

function drawTitle(c: CanvasRenderingContext2D, x: number, top: number, title: TitleLayout) {
  c.font = `700 ${title.size}px ${FONT}`;
  c.fillStyle = INK.title;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  title.lines.forEach((line, i) => {
    c.fillText(line, x, top + i * title.lineH + title.size * 0.96);
  });
}

function drawPanel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.save();
  c.shadowColor = 'rgba(0,0,0,.22)';
  c.shadowBlur = 34;
  c.shadowOffsetY = 8;
  c.fillStyle = '#ffffff';
  roundRect(c, x, y, w, h, r);
  c.fill();
  c.restore();
}

// state と読み込み済み画像を束ねた描画一式。元の単一 HTML 版で IIFE のクロージャが
// 持っていたものを、React の外に切り出したもの。
export function createScene(state: State, images: Images, createCanvas: CanvasFactory) {
  const { bgImages, avatarImg, logoImg } = images;

  function hasAuthorRow() {
    return Boolean(state.author.trim() || state.role.trim() || avatarImg);
  }

  function layoutTitle(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
    const paragraphs = text.split('\n').filter((p, i, a) => p.trim() !== '' || a.length === 1);
    const build = (size: number) => {
      c.font = `700 ${size}px ${FONT}`;
      return paragraphs.flatMap((p) => wrapLine(c, p, maxW));
    };
    if (!state.autoSize) {
      const lines = build(state.titleSize);
      return { size: state.titleSize, lines, overflow: lines.length > maxLines };
    }
    // 手で入れた改行をそのまま活かせる最大サイズを優先する
    if (paragraphs.length <= maxLines) {
      for (let size = 54; size >= 34; size -= 1) {
        const lines = build(size);
        if (lines.length === paragraphs.length) return { size, lines, overflow: false };
      }
    }
    // 収まらなければ自動折り返しに任せる
    for (let size = 54; size >= 24; size -= 1) {
      const lines = build(size);
      if (lines.length <= maxLines) return { size, lines, overflow: false };
    }
    const lines = build(24);
    return { size: 24, lines, overflow: lines.length > maxLines };
  }

  function measureTitle(c: CanvasRenderingContext2D, maxW: number) {
    const t = layoutTitle(c, state.title || 'タイトルを入力してください', maxW, 4) as TitleLayout;
    t.lineH = Math.round(t.size * 1.44);
    t.height = t.lines.length * t.lineH;
    return t;
  }

  function drawAuthorRow(c: CanvasRenderingContext2D, x: number, top: number) {
    let textX = x;
    if (avatarImg) {
      c.save();
      c.beginPath();
      c.arc(x + AVATAR_D / 2, top + AVATAR_D / 2, AVATAR_D / 2, 0, Math.PI * 2);
      c.closePath();
      c.clip();
      drawCover(c, avatarImg, x, top, AVATAR_D, AVATAR_D);
      c.restore();
      c.save();
      c.beginPath();
      c.arc(x + AVATAR_D / 2, top + AVATAR_D / 2, AVATAR_D / 2 - 0.5, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(0,0,0,.10)';
      c.lineWidth = 1;
      c.stroke();
      c.restore();
      textX = x + AVATAR_D + 20;
    }

    const name = state.author.trim();
    const role = state.role.trim();

    if (name && role) {
      c.font = `500 24px ${FONT}`;
      c.fillStyle = INK.name;
      c.fillText(name, textX, top + 27);
      c.font = `400 16px ${FONT}`;
      c.fillStyle = INK.role;
      c.fillText(role, textX, top + 55);
    } else if (name || role) {
      c.font = `500 24px ${FONT}`;
      c.fillStyle = name ? INK.name : INK.role;
      c.fillText(name || role, textX, top + AVATAR_D / 2 + 9);
    }
  }

  function render(c: CanvasRenderingContext2D) {
    c.clearRect(0, 0, W, H);

    const bg = bgImages[state.bg] || null;
    if (bg) drawCover(c, bg, 0, 0, W, H);
    else { c.fillStyle = '#dfe3e8'; c.fillRect(0, 0, W, H); }

    drawPanel(c, CARD_MARGIN, CARD_MARGIN, W - CARD_MARGIN * 2, H - CARD_MARGIN * 2, 26);

    const contentRight = W - PAD_X;
    const cardBottom = H - CARD_MARGIN;

    // ロゴはカードの右下角に固定する（本文の量に影響されない）
    const logo = state.showLogo ? logoImg : null;
    let logoTop = cardBottom - LOGO_PAD_BOTTOM;
    if (logo) {
      const box = measureContain(logo, LOGO_MAX_W, LOGO_MAX_H);
      // 右下角に近いインクの下端を基準に置く
      const inkBottom = box.h * (1 - logoBottomInsetRatio(logo, createCanvas));
      logoTop = cardBottom - LOGO_PAD_BOTTOM - inkBottom;
      c.drawImage(logo, contentRight - box.w, logoTop, box.w, box.h);
    }

    const title = measureTitle(c, W - PAD_X * 2 - 40);
    const blockH = title.height + (hasAuthorRow() ? AUTHOR_GAP + AUTHOR_H : 0);

    // タイトルと著者はロゴに掛からない範囲で光学的な中心に置く
    const areaTop = CARD_MARGIN + 88;
    const areaBottom = logo ? logoTop - 28 : cardBottom - CARD_PAD;
    const blockTop = Math.max(areaTop, areaTop + (areaBottom - areaTop - blockH) / 2);

    drawTitle(c, PAD_X, blockTop, title);
    if (hasAuthorRow()) drawAuthorRow(c, PAD_X, blockTop + title.height + AUTHOR_GAP);

    return { overflow: title.overflow };
  }

  function renderToCanvas(scale: number) {
    const out = createCanvas(W * scale, H * scale);
    const octx = out.getContext('2d');
    if (!octx) throw new Error('canvas を初期化できませんでした');
    octx.scale(scale, scale);
    render(octx);
    return out;
  }

  return { render, renderToCanvas };
}
