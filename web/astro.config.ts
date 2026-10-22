import { defineConfig, envField, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { unified } from "@astrojs/markdown-remark";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { transformerFileName } from "./src/utils/transformers/fileName";
import { SITE } from "./src/config";
import rehypeLazyImages from "./src/utils/rehypeLazyImages";
import rehypeDemoteH1 from "./src/utils/rehypeDemoteH1";
import remarkSoftBreaks from "./src/utils/remarkSoftBreaks";

// 访客分站：同一份源码再构建一次，输出到 dist-guest，缓存目录分开以免内容集合互相串
const GUEST_BUILD = process.env.GUEST_BUILD === "1";

// https://astro.build/config
export default defineConfig({
  site: SITE.website,
  ...(GUEST_BUILD
    ? { outDir: "./dist-guest", cacheDir: "./node_modules/.astro-guest" }
    : {}),
  // 与 Cloudflare Pages 的目录式 URL 一致：分页链接等也生成 /posts/2/ 形式
  trailingSlash: "always",
  // Astro 7 默认 jsx 规则压缩空白，保持 v5/v6 的 HTML 规则
  compressHTML: true,
  markdown: {
    // Astro 7 默认用 Sätteri；继续用 unified 以保留 remark 插件
    processor: unified({
      remarkPlugins: [
        remarkToc,
        [remarkCollapse, { test: "Table of contents" }],
        remarkSoftBreaks,
      ],
      rehypePlugins: [rehypeDemoteH1, rehypeLazyImages],
    }),
    shikiConfig: {
      // For more themes, visit https://shiki.style/themes
      themes: { light: "rose-pine-dawn", dark: "rose-pine-moon" },
      defaultColor: false,
      wrap: false,
      transformers: [
        transformerFileName({ style: "v2", hideDot: false }),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
        transformerNotationDiff({ matchAlgorithm: "v3" }),
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
  },
  image: {
    responsiveStyles: true,
    layout: "constrained",
  },
  env: {
    schema: {
      PUBLIC_GOOGLE_SITE_VERIFICATION: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
    },
  },
  fonts: [
    {
      name: "Google Sans Code",
      cssVariable: "--font-google-sans-code",
      provider: fontProviders.google(),
      fallbacks: ["monospace"],
      // 可变字体：一个区间即可；只用于代码，不需要斜体
      weights: ["300 700"],
      styles: ["normal"],
    },
  ],
});
