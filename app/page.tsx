import OgImageGenerator from "./OgImageGenerator";

export default function Home() {
  return (
    <>
      <header>
        <h1>OG Image Generator</h1>
        <p>テックブログ用の 1200×630 OG 画像を作って PNG でダウンロードします。画像の加工はブラウザ内で完結し、選んだ画像が外部に送られることはありません（Gravatar を使うときだけ gravatar.com にリクエストします）。</p>
      </header>
      <OgImageGenerator />
    </>
  );
}
