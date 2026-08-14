'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const W = 1200, H = 630;
const FONT = '"Noto Sans JP", -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';
const STORE_KEY = 'og-image-generator/v1';

const LOGO_DEFAULT = '/logo-default.png';

const BG_SOURCES: Record<string, string> = {
  p1: '/bg/p1.png',
  p2: '/bg/p2.png',
  p3: '/bg/p3.png',
};

type State = {
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

const INITIAL_STATE: State = {
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
type Images = {
  bgImages: Record<string, HTMLImageElement>;
  customBg: HTMLImageElement | null;
  avatarImg: HTMLImageElement | null;
  logoImg: HTMLImageElement | null;
  logoDefaultImg: HTMLImageElement | null;
};

// ---------- 画像ロード ----------

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 他オリジンの画像を canvas に描く場合、これがないと書き出し時に汚染で失敗する
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

async function sha256Hex(text: string) {
  if (!window.crypto || !crypto.subtle) {
    throw new Error('SECURE_CONTEXT');
  }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
    fr.readAsDataURL(file);
  });
}

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
function logoBottomInsetRatio(img: HTMLImageElement) {
  const cached = logoInsetCache.get(img);
  if (cached !== undefined) return cached;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const band = Math.max(1, Math.round(w * 0.15));
  let ratio = 0;
  try {
    const cv = document.createElement('canvas');
    cv.width = band;
    cv.height = h;
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

// ---------- 本体 ----------

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
function createScene(state: State, images: Images) {
  const { bgImages, customBg, avatarImg, logoImg, logoDefaultImg } = images;

  function activeBg() {
    return customBg || bgImages[state.bg] || null;
  }

  function activeLogo() {
    if (!state.showLogo) return null;
    return logoImg || logoDefaultImg;
  }

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

    const bg = activeBg();
    if (bg) drawCover(c, bg, 0, 0, W, H);
    else { c.fillStyle = '#dfe3e8'; c.fillRect(0, 0, W, H); }

    drawPanel(c, CARD_MARGIN, CARD_MARGIN, W - CARD_MARGIN * 2, H - CARD_MARGIN * 2, 26);

    const contentRight = W - PAD_X;
    const cardBottom = H - CARD_MARGIN;

    // ロゴはカードの右下角に固定する（本文の量に影響されない）
    const logo = activeLogo();
    let logoTop = cardBottom - LOGO_PAD_BOTTOM;
    if (logo) {
      const box = measureContain(logo, LOGO_MAX_W, LOGO_MAX_H);
      // 右下角に近いインクの下端を基準に置く
      const inkBottom = box.h * (1 - logoBottomInsetRatio(logo));
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
    const out = document.createElement('canvas');
    out.width = W * scale;
    out.height = H * scale;
    const octx = out.getContext('2d');
    if (!octx) throw new Error('canvas を初期化できませんでした');
    octx.scale(scale, scale);
    render(octx);
    return out;
  }

  return { render, renderToCanvas };
}

// Google Fonts は用途別にサブセット配信されるため、実際に使う文字を渡して読み込ませる
async function ensureFonts(text: string) {
  if (!document.fonts) return false;
  const sample = (text || '') + 'ABCabc0123';
  try {
    await Promise.all([
      document.fonts.load(`700 48px "Noto Sans JP"`, sample),
      document.fonts.load(`500 24px "Noto Sans JP"`, sample),
      document.fonts.load(`400 16px "Noto Sans JP"`, sample),
    ]);
    await document.fonts.ready;
    return true;
  } catch {
    // CDN に到達できない場合はフォールバックフォントで描画する
    return false;
  }
}

function toBlob(cv: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
}

function save(state: State) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      author: state.author, role: state.role, email: state.email, bg: state.bg,
      showLogo: state.showLogo, autoSize: state.autoSize, titleSize: state.titleSize,
    }));
  } catch { /* プライベートモード等では保存しない */ }
}

function restore(): State {
  let saved: Partial<State> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch { /* 壊れていたら初期値のまま */ }
  const state = { ...INITIAL_STATE, ...saved };
  // 保存済みの値が今の選択肢に無くても描画が落ちないようにする
  if (!Object.prototype.hasOwnProperty.call(BG_SOURCES, state.bg)) state.bg = 'p1';
  return state;
}

export default function OgImageGenerator() {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [warn, setWarn] = useState('');
  const [status, setStatus] = useState('');
  const [avatarNote, setAvatarNote] = useState({ msg: '', isError: false });
  // 画像は ref に持つので、差し替えたことを描画に伝えるためのカウンタ
  const [imageVersion, setImageVersion] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgCustomInputRef = useRef<HTMLInputElement>(null);

  const imagesRef = useRef<Images>({
    bgImages: {},
    customBg: null,
    avatarImg: null,
    logoImg: null,
    logoDefaultImg: null,
  });
  const fontsReadyRef = useRef(false);
  const lastSampleRef = useRef<string | null>(null);
  const gravatarTokenRef = useRef(0);
  const gravatarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpImages = useCallback(() => setImageVersion((v) => v + 1), []);

  const update = useCallback((patch: Partial<State>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      save(next);
      return next;
    });
  }, []);

  const setStatusMsg = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (msg) {
      statusTimerRef.current = setTimeout(() => {
        setStatus((cur) => (cur === msg ? '' : cur));
      }, 4000);
    }
  }, []);

  // Gravatar は MD5 と SHA-256 のどちらのハッシュも受け付ける。ブラウザ標準で計算できる
  // SHA-256 を使うことで MD5 実装を持ち込まずに済む（要セキュアコンテキスト）。
  const applyGravatar = useCallback(async (email: string) => {
    const token = ++gravatarTokenRef.current;
    const addr = email.trim().toLowerCase();
    if (!addr) { setAvatarNote({ msg: '', isError: false }); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      setAvatarNote({ msg: 'メールアドレスの形式で入力してください', isError: true });
      return;
    }
    setAvatarNote({ msg: 'Gravatar を取得中…', isError: false });
    try {
      const hash = await sha256Hex(addr);
      // d=404 にすると未登録時に 404 が返り、onerror で判別できる
      const img = await loadImage(`https://www.gravatar.com/avatar/${hash}?s=256&d=404`, 'anonymous');
      if (token !== gravatarTokenRef.current) return;
      imagesRef.current.avatarImg = img;
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      setAvatarNote({ msg: 'Gravatar を読み込みました', isError: false });
      bumpImages();
    } catch (err) {
      if (token !== gravatarTokenRef.current) return;
      setAvatarNote({
        msg: (err as Error).message === 'SECURE_CONTEXT'
          ? 'この開き方では SHA-256 を計算できません。https か localhost 経由で開いてください'
          : 'Gravatar を取得できませんでした（未登録かネットワークエラー）',
        isError: true,
      });
    }
  }, [bumpImages]);

  // ---------- 起動 ----------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // localStorage / Image はサーバ側に無いので、参照は必ずマウント後に行う
      const restored = restore();
      setState(restored);

      const [entries, defaultLogo] = await Promise.all([
        Promise.all(Object.entries(BG_SOURCES).map(async ([key, src]) => [key, await loadImage(src)] as const)),
        loadImage(LOGO_DEFAULT).catch(() => null),
      ]);
      if (cancelled) return;
      for (const [key, img] of entries) {
        imagesRef.current.bgImages[key] = img;
      }
      imagesRef.current.logoDefaultImg = defaultLogo;
      bumpImages();
      if (restored.email.trim()) applyGravatar(restored.email);
    })();

    return () => { cancelled = true; };
  }, [applyGravatar, bumpImages]);

  // ---------- 描画 ----------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scene = createScene(state, imagesRef.current);
    const showWarning = (result: { overflow: boolean }) => {
      setWarn(result && result.overflow
        ? '⚠ タイトルが長すぎて枠に収まりません。改行を入れるか文字数を減らしてください。'
        : '');
    };

    showWarning(scene.render(ctx));

    let cancelled = false;
    const sample = state.title + state.author + state.role;
    if (!fontsReadyRef.current || sample !== lastSampleRef.current) {
      lastSampleRef.current = sample;
      (async () => {
        const ok = await ensureFonts(sample);
        if (ok) fontsReadyRef.current = true;
        if (cancelled) return; // 描画中に入力が変わった
        showWarning(scene.render(ctx));
      })();
    }

    return () => { cancelled = true; };
  }, [state, imageVersion]);

  // ---------- 入出力 ----------

  const filename = (ext: string) => {
    const base = (state.title.split('\n')[0] || 'og-image')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .slice(0, 40) || 'og-image';
    return `${base}.${ext}`;
  };

  const handleFile = async (input: HTMLInputElement, assign: (img: HTMLImageElement) => void) => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const img = await loadImage(await readFileAsDataURL(file));
      assign(img);
      bumpImages();
    } catch (err) {
      setStatusMsg((err as Error).message);
    }
  };

  const onEmailInput = (value: string) => {
    update({ email: value });
    if (gravatarTimerRef.current) clearTimeout(gravatarTimerRef.current);
    gravatarTimerRef.current = setTimeout(() => applyGravatar(value), 500);
  };

  const onClearImages = () => {
    imagesRef.current.avatarImg = null;
    imagesRef.current.logoImg = null;
    imagesRef.current.customBg = null;
    gravatarTokenRef.current += 1;
    setAvatarNote({ msg: '', isError: false });
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    if (logoInputRef.current) logoInputRef.current.value = '';
    if (bgCustomInputRef.current) bgCustomInputRef.current.value = '';
    update({ email: '' });
    bumpImages();
  };

  const onDownload = async () => {
    const scene = createScene(state, imagesRef.current);
    const blob = await toBlob(scene.renderToCanvas(state.scale));
    if (!blob) { setStatusMsg('PNG を書き出せませんでした'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename('png');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusMsg(`${filename('png')} を保存しました（${W * state.scale}×${H * state.scale}）`);
  };

  const onCopy = async () => {
    if (!navigator.clipboard || !window.ClipboardItem) {
      setStatusMsg('このブラウザは画像のクリップボードコピーに対応していません');
      return;
    }
    try {
      const scene = createScene(state, imagesRef.current);
      const blob = await toBlob(scene.renderToCanvas(state.scale));
      if (!blob) throw new Error('PNG を書き出せませんでした');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatusMsg('クリップボードにコピーしました');
    } catch (err) {
      setStatusMsg('コピーできませんでした: ' + (err as Error).message);
    }
  };

  const onReset = () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* noop */ }
    location.reload();
  };

  return (
    <main>
      <form className="panel" id="form" autoComplete="off">
        <fieldset>
          <legend>内容</legend>
          <label className="field">
            <span>タイトル（改行で明示的に折り返し）</span>
            <textarea
              id="title"
              rows={3}
              placeholder={'記事のタイトルをここに\n改行するとそこで折り返します'}
              value={state.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>著者名</span>
            <input
              type="text"
              id="author"
              placeholder="山田 太郎"
              value={state.author}
              onChange={(e) => update({ author: e.target.value })}
            />
          </label>
          <label className="field">
            <span>所属・肩書き</span>
            <input
              type="text"
              id="role"
              placeholder="技術部 エンジニア"
              value={state.role}
              onChange={(e) => update({ role: e.target.value })}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>画像</legend>
          <label className="field">
            <span>アバター: メールアドレス（Gravatar から取得）</span>
            <input
              type="text"
              id="email"
              inputMode="email"
              placeholder="you@example.com"
              value={state.email}
              onChange={(e) => onEmailInput(e.target.value)}
            />
          </label>
          <p className={avatarNote.isError ? 'note err' : 'note'} id="avatarNote">{avatarNote.msg}</p>
          <label className="field">
            <span>アバター: 画像ファイル（任意・正方形推奨）</span>
            <input
              type="file"
              id="avatar"
              accept="image/*"
              ref={avatarInputRef}
              onChange={(e) => handleFile(e.target, (img) => {
                imagesRef.current.avatarImg = img;
                setAvatarNote({ msg: '', isError: false });
              })}
            />
          </label>
          <label className="field">
            <span>ロゴ（未指定なら Pepabo Tech Portal のロゴを右下に配置）</span>
            <input
              type="file"
              id="logo"
              accept="image/*"
              ref={logoInputRef}
              onChange={(e) => handleFile(e.target, (img) => { imagesRef.current.logoImg = img; })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              id="showLogo"
              checked={state.showLogo}
              onChange={(e) => update({ showLogo: e.target.checked })}
            /> ロゴを表示する
          </label>
          <button type="button" id="clearImages" onClick={onClearImages}>画像をリセット</button>
        </fieldset>

        <fieldset>
          <legend>背景</legend>
          <div className="swatches" id="bgSwatches">
            {Object.keys(BG_SOURCES).map((key) => (
              <Swatch
                key={key}
                value={key}
                checked={state.bg === key}
                onChange={() => update({ bg: key })}
              />
            ))}
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span>差し替え（任意・上の3枚の代わりに使う）</span>
            <input
              type="file"
              id="bgCustom"
              accept="image/*"
              ref={bgCustomInputRef}
              onChange={(e) => handleFile(e.target, (img) => { imagesRef.current.customBg = img; })}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>タイトルの体裁</legend>
          <label className="check">
            <input
              type="checkbox"
              id="autoSize"
              checked={state.autoSize}
              onChange={(e) => update({ autoSize: e.target.checked })}
            /> タイトルの文字サイズを自動調整
          </label>
          <div className="row">
            <input
              type="range"
              id="titleSize"
              min="24"
              max="60"
              step="1"
              value={state.titleSize}
              disabled={state.autoSize}
              onChange={(e) => update({ titleSize: Number(e.target.value) })}
            />
            <output id="titleSizeOut">{state.titleSize}</output>
          </div>
        </fieldset>

        <fieldset>
          <legend>書き出し</legend>
          <div className="seg" id="scaleSeg">
            <input
              type="radio"
              name="scale"
              id="scale-1"
              value="1"
              checked={state.scale === 1}
              onChange={() => update({ scale: 1 })}
            /><label htmlFor="scale-1">1200×630</label>
            <input
              type="radio"
              name="scale"
              id="scale-2"
              value="2"
              checked={state.scale === 2}
              onChange={() => update({ scale: 2 })}
            /><label htmlFor="scale-2">2400×1260 (2x)</label>
          </div>
        </fieldset>
      </form>

      <div className="preview-wrap">
        <div className="canvas-box">
          <canvas id="canvas" ref={canvasRef} width={W} height={H}></canvas>
        </div>
        <div className="actions">
          <button type="button" className="primary" id="download" onClick={onDownload}>PNG をダウンロード</button>
          <button type="button" id="copy" onClick={onCopy}>クリップボードにコピー</button>
          <button type="button" id="reset" onClick={onReset}>リセット</button>
        </div>
        <div className="status" id="warn" style={{ color: '#c0392b' }}>{warn}</div>
        <div className="status" id="status">{status}</div>
        <p className="meta">
          入力内容（著者名・所属・背景の選択）はブラウザに保存され、次回開いたときに復元されます。<br />
          フォントは Noto Sans JP を CDN から読み込みます。オフラインの場合は端末のゴシック体で描画されます。
        </p>
      </div>
    </main>
  );
}

// input:checked + label で見た目を切り替えるので、両者は必ず隣接させる
function Swatch({ value, checked, onChange }: { value: string; checked: boolean; onChange: () => void }) {
  return (
    <>
      <input type="radio" name="bg" id={`bg-${value}`} value={value} checked={checked} onChange={onChange} />
      <label
        htmlFor={`bg-${value}`}
        title={value}
        style={{ backgroundImage: `url("${BG_SOURCES[value]}")` }}
      ></label>
    </>
  );
}
