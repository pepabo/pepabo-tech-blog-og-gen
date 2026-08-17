import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ロリポップ！デプロイナウは standalone 出力を前提にしている
  output: "standalone",
  // ネイティブモジュールなのでバンドルさせず、実行時に require させる
  serverExternalPackages: ["@napi-rs/canvas"],
  // /api/og が fs から読むファイルはコード解析では追跡されないので明示する
  outputFileTracingIncludes: {
    "/api/og": ["./fonts/*.otf", "./public/bg/*.png", "./public/logo-default.png"],
  },
  // Slack や X のリンク展開は content-type ではなく拡張子を見ていることがあるので、
  // .png で終わる別名も用意する（クエリはそのまま引き継がれる）
  async rewrites() {
    return [{ source: "/og.png", destination: "/api/og" }];
  },
};

export default nextConfig;
