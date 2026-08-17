import OgImageGenerator from "./OgImageGenerator";

export default function Home() {
  return (
    <>
      <header>
        <h1>OG Image Generator</h1>
        <p>テックブログ用の 1200×630 OG 画像を作って PNG でダウンロードします。描画はブラウザ内で完結します（Gravatar を使うときだけ gravatar.com にリクエストします）。「画像URLをコピー」で得られる <code>/api/og?…</code> はサーバー側で同じ画像を生成する URL なので、そちらを使うときはクエリに入れた文字列とメールアドレスがサーバーに渡ります。</p>
      </header>
      <OgImageGenerator />
    </>
  );
}
