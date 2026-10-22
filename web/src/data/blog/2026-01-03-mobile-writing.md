---
title: "用手机 App 离线写作"
description: "配套 Android App 的使用示例：离线写草稿，联网后一键同步到 GitHub。"
pubDatetime: 2026-01-03T09:00:00+08:00
tags: ["示例", "App"]
---

这是第三篇示例文章，演示**网站 + App** 的配套工作流。

## 工作流

1. 手机上打开 App，没网也能写，草稿存在本地。
2. 有网后点同步，App 通过 GitHub API 直接提交到仓库。
3. 网站重新构建，文章上线。

## App 里能改的配置

- 博客 API 地址（默认 `https://your-blog.example.com`）
- 站点密码（和网站后台共用）
- 同步的仓库与分支（默认 `your-username/your-repo` 的 `main` 分支）

## 注意事项

示例配置里全是占位符，部署前记得换成你自己的：

- `src/config.ts` 里的站点域名、作者名
- App `net/Auth.java` 里的博客地址和口令

三篇示例文章介绍完毕，开始写你自己的内容吧。
