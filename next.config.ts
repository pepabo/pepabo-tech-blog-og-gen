import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ロリポップ！デプロイナウは standalone 出力を前提にしている
  output: "standalone",
};

export default nextConfig;
