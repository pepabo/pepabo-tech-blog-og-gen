'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BG_SOURCES, H, INITIAL_STATE, LOGO_DEFAULT, W,
  createScene, type CanvasFactory, type Images, type State,
} from './scene';
import { ogFilename, stateToQuery } from './params';

const STORE_KEY = 'og-image-generator/v1';

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

const browserCanvas: CanvasFactory = (w, h) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
};

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

  const imagesRef = useRef<Images>({
    bgImages: {},
    avatarImg: null,
    logoImg: null,
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
      imagesRef.current.logoImg = defaultLogo;
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

    const scene = createScene(state, imagesRef.current, browserCanvas);
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

  const onEmailInput = (value: string) => {
    update({ email: value });
    if (gravatarTimerRef.current) clearTimeout(gravatarTimerRef.current);
    gravatarTimerRef.current = setTimeout(() => applyGravatar(value), 500);
  };

  // メールアドレスを消しても取得済みのアバターは残るので、消す手段としてこれが要る
  const onClearAvatar = () => {
    imagesRef.current.avatarImg = null;
    gravatarTokenRef.current += 1;
    setAvatarNote({ msg: '', isError: false });
    update({ email: '' });
    bumpImages();
  };

  const onDownload = async () => {
    const scene = createScene(state, imagesRef.current, browserCanvas);
    const blob = await toBlob(scene.renderToCanvas(state.scale));
    if (!blob) { setStatusMsg('PNG を書き出せませんでした'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ogFilename(state.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusMsg(`${ogFilename(state.title)} を保存しました（${W * state.scale}×${H * state.scale}）`);
  };

  const onCopy = async () => {
    if (!navigator.clipboard || !window.ClipboardItem) {
      setStatusMsg('このブラウザは画像のクリップボードコピーに対応していません');
      return;
    }
    try {
      const scene = createScene(state, imagesRef.current, browserCanvas);
      const blob = await toBlob(scene.renderToCanvas(state.scale));
      if (!blob) throw new Error('PNG を書き出せませんでした');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatusMsg('クリップボードにコピーしました');
    } catch (err) {
      setStatusMsg('コピーできませんでした: ' + (err as Error).message);
    }
  };

  // 同じ内容をサーバー側で描く URL。State はすべてクエリで表現できるので、
  // メールアドレスを消したあとにアバターが残っている場合を除けば結果は一致する
  const onCopyUrl = async () => {
    // 貼り付け先でリンク展開されやすいよう、拡張子付きの別名（/api/og への rewrite）を使う
    const url = `${location.origin}/og.png?${stateToQuery(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatusMsg('画像URLをコピーしました');
    } catch {
      setStatusMsg('URL をコピーできませんでした');
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
          <legend>アバターとロゴ</legend>
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
          <label className="check">
            <input
              type="checkbox"
              id="showLogo"
              checked={state.showLogo}
              onChange={(e) => update({ showLogo: e.target.checked })}
            /> Pepabo Tech Portal のロゴを右下に表示する
          </label>
          <button type="button" id="clearAvatar" onClick={onClearAvatar}>アバターをリセット</button>
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
          <button type="button" id="copyUrl" onClick={onCopyUrl}>画像URLをコピー</button>
          <button type="button" id="reset" onClick={onReset}>リセット</button>
        </div>
        <div className="status" id="warn" style={{ color: '#c0392b' }}>{warn}</div>
        <div className="status" id="status">{status}</div>
        <p className="meta">
          入力内容（著者名・所属・背景の選択）はブラウザに保存され、次回開いたときに復元されます。<br />
          フォントは Noto Sans JP を CDN から読み込みます。オフラインの場合は端末のゴシック体で描画されます。<br />
          「画像URLをコピー」で得られる <code>/og.png?…</code> はサーバー側で同じ画像を生成する URL です。
          Slack に貼れば画像として展開され、<code>&lt;img&gt;</code> や curl からも取得できます。
          <code>&amp;dl=1</code> を付けて開くとそのままダウンロードになります（この形はリンク展開されません）。
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
