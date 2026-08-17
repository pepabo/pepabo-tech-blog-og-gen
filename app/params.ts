// クエリパラメータと State の相互変換。/api/og（サーバー描画）とフォームの「画像URLをコピー」で
// 同じ定義を使う。State はすべてクエリで表現できるので、フォームの内容と URL の生成結果は
// 一致する（例外はメールアドレスを消したあとに取得済みのアバターが残っているときだけ）。

import { BG_SOURCES, INITIAL_STATE, type State } from './scene';

const MAX_TITLE = 300;
const MAX_FIELD = 120;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function stateToQuery(state: State) {
  const sp = new URLSearchParams();
  if (state.title.trim()) sp.set('title', state.title);
  if (state.author.trim()) sp.set('author', state.author);
  if (state.role.trim()) sp.set('role', state.role);
  if (state.email.trim()) sp.set('email', state.email);
  if (state.bg !== INITIAL_STATE.bg) sp.set('bg', state.bg);
  if (!state.showLogo) sp.set('logo', '0');
  // size を渡すこと自体が「自動調整しない」の意味になる
  if (!state.autoSize) sp.set('size', String(state.titleSize));
  if (state.scale !== 1) sp.set('scale', String(state.scale));
  return sp.toString();
}

export function queryToState(sp: URLSearchParams): State {
  const text = (key: string, max: number) => (sp.get(key) || '').replace(/\r\n?/g, '\n').slice(0, max);
  const bg = sp.get('bg') || '';
  const size = Number(sp.get('size'));
  const hasSize = sp.has('size') && Number.isFinite(size) && size > 0;
  return {
    ...INITIAL_STATE,
    title: text('title', MAX_TITLE),
    author: text('author', MAX_FIELD),
    role: text('role', MAX_FIELD),
    email: text('email', MAX_FIELD),
    bg: Object.prototype.hasOwnProperty.call(BG_SOURCES, bg) ? bg : INITIAL_STATE.bg,
    showLogo: sp.get('logo') !== '0',
    autoSize: !hasSize,
    titleSize: hasSize ? clamp(Math.round(size), 24, 60) : INITIAL_STATE.titleSize,
    scale: sp.get('scale') === '2' ? 2 : 1,
  };
}

export function ogFilename(title: string) {
  const base = (title.split('\n')[0] || 'og-image')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 40) || 'og-image';
  return `${base}.png`;
}
