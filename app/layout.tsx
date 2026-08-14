import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OG Image Generator",
  description: "テックブログ用の 1200×630 OG 画像を作って PNG でダウンロードします。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      {/*
        next/font は使わない。canvas 側は ctx.font / document.fonts.load に
        リテラルのファミリ名 "Noto Sans JP" を渡して日本語サブセットを
        先読みさせているため、ハッシュ名にリネームされると指定が効かなくなる。
      */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- Pages Router 向けの警告。App Router のルートレイアウトなので全ページに適用される */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
