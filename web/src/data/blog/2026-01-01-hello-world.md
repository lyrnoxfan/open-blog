---
title: "你好，世界"
description: "这是示例博客的第一篇文章，介绍这个开源博客模板的基本用法。"
pubDatetime: 2026-01-01T09:00:00+08:00
tags: ["示例", "指南"]
---

欢迎！这是一篇示例文章，用来展示这个博客模板的写作格式。

## 文章放在哪里

所有文章都是 `src/data/blog/` 目录下的 Markdown 文件。文件名建议用 `日期-标题` 的格式，例如 `2026-01-01-hello-world.md`。

## Frontmatter

每篇文章开头需要一段 YAML frontmatter：

```yaml
---
title: "文章标题"
description: "一句话摘要，会显示在列表和 SEO 里"
pubDatetime: 2026-01-01T09:00:00+08:00
tags: ["示例", "指南"]
---
```

可选字段：`modDatetime`（修改时间）、`draft: true`（草稿，不公开展示）、`pinned: true`（置顶）。

## 发布

把 Markdown 提交到仓库，Cloudflare Pages 会自动重新构建并发布。就这么简单。
