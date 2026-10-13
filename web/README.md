# Blog Web

Astro 静态博客网站。文章是 `src/data/blog/` 里的 Markdown，push 后自动构建发布。

```bash
pnpm install
pnpm dev      # 本地预览
pnpm build    # 构建
```

配置在 `src/config.ts`（站点域名、作者名、评论服务地址等），示例值全是占位符，部署前换成你自己的。

写文章：在 `src/data/blog/` 下新建 `YYYY-MM-DD-标题.md`，frontmatter 参考 `2026-01-01-hello-world.md`。

MIT License.
