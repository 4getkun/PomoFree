// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// 公開URL: https://fourgetkun.com/pomofree/ （fourgetkun-hub 配下）
//
// ビルド成果物の置き場は従来どおり GitHub Pages（https://4getkun.github.io/PomoFree/）だが、
// ここは「配信元」。利用者が見るのは fourgetkun.com/pomofree/ で、fourgetkun-hub の Worker が
// /pomofree/* を GitHub Pages から取ってきて返す（src/pages-proxy/proxy.js）。そのため site/base は
// 公開側に合わせる。GitHub Pages の URL で開かれたら、Layout.astro がデータごと新 URL へ送る。
// https://astro.build/config
export default defineConfig({
  site: "https://fourgetkun.com",
  base: "/pomofree",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
