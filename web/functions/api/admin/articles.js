import { apiError, apiJson, articlePath, authorize, base64Utf8, github, githubTreeTexts, resolveBranch, utf8Base64 } from "./_github.js";

export async function onRequestGet(context) {
  const denied = authorize(context);
  if (denied) return denied;
  const url = new URL(context.request.url);
  const slug = url.searchParams.get("slug");
  try {
    const targetBranch = await resolveBranch(context);
    if (slug) {
      const path = articlePath(slug);
      if (!path) return apiError("Invalid article slug");
      let file = await github(context, `/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(targetBranch)}`);
      if (file.type !== "file" || file.size > 2_000_000) return apiError("Invalid article", 422);
      // 超过 1MB 的文件 contents 接口返回空 content：改从 blob 取，避免编辑器载入空文、保存时覆盖原文
      if (file.encoding !== "base64") {
        const blob = await github(context, `/git/blobs/${file.sha}`);
        if (blob.encoding !== "base64") return apiError("Invalid article", 422);
        file = { ...file, content: blob.content };
      }
      return apiJson({ slug: path.slice("src/data/blog/".length, -3), sha: file.sha, content: utf8Base64(file.content) });
    }
    const tree = await github(context, `/git/trees/${encodeURIComponent(targetBranch)}?recursive=1`);
    const branch = targetBranch;
    const items = tree.tree
      .filter(item => item.type === "blob" && item.path.startsWith("src/data/blog/") && item.path.endsWith(".md") && !item.path.slice(14).includes("/"));
    // lite=1：APK 同步专用轻量列表，只返回 slug+sha（一次 GitHub 调用），
    // 不需要标题/标签时别用全量接口（全量要对每篇文章再调一次 GitHub 取 frontmatter）
    if (url.searchParams.get("lite")) {
      const articles = items.map(item => ({
        slug: item.path.slice("src/data/blog/".length, -3),
        sha: item.sha,
      }));
      articles.sort((a, b) => b.slug.localeCompare(a.slug, "zh-CN"));
      return apiJson({ articles });
    }
    // 卡片列表需要标题/草稿/发布时间：逐个取 frontmatter（单人后台，量小可接受）
    // 顺带收集全站标签，供写作台标签自动补全用
    const tagSet = new Set();
    const texts = await githubTreeTexts(context, branch, "src/data/blog");
    const articles = await Promise.all(items.map(async item => {
      const slug = item.path.slice("src/data/blog/".length, -3);
      const base = { slug, sha: item.sha, title: slug, draft: false, pubDatetime: "" };
      try {
        let text = texts?.get(item.sha);
        if (typeof text !== "string") {
          const file = await github(context, `/contents/${encodeURIComponent(item.path)}?ref=${encodeURIComponent(branch)}`);
          if (file.type !== "file" || file.size > 2_000_000 || file.encoding !== "base64") return base;
          text = utf8Base64(file.content);
        }
        const fm = (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
        const pick = key => {
          const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
          return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
        };
        // 标签只取 flow 写法 tags: ["a", "b"]（写作台统一按此格式写入）
        const pickTags = () => {
          const m = fm.match(/^tags:\s*(\[.*\])\s*$/m);
          if (!m) return [];
          try {
            const arr = JSON.parse(m[1]);
            return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
          } catch {
            return [];
          }
        };
        return {
          ...base,
          title: pick("title") || slug,
          draft: pick("draft") === "true",
          pubDatetime: pick("pubDatetime"),
          tags: pickTags(),
        };
      } catch {
        return base;
      }
    }));
    articles.sort((a, b) => b.slug.localeCompare(a.slug, "zh-CN"));
    // 把每篇文章的 tags 并入全站标签集合
    for (const a of articles) for (const t of a.tags || []) tagSet.add(t);
    const tags = [...tagSet].sort((a, b) => a.localeCompare(b, "zh-CN"));
    return apiJson({ articles, tags });
  } catch (error) {
    return apiError(error.message, error.status === 404 ? 404 : 502);
  }
}

export async function onRequestPut(context) {
  const denied = authorize(context, true);
  if (denied) return denied;
  try {
    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("Invalid JSON body");
    if (body.sha && !/^[0-9a-f]{40}$/.test(String(body.sha))) return apiError("Invalid article or revision");
    const path = articlePath(body.slug);
    if (!path || typeof body.content !== "string" || body.content.length > 1_500_000) return apiError("Invalid article");
    if (!/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(body.content)) return apiError("Article must contain frontmatter");
    const payload = { message: `${body.sha ? "Update" : "Create"} post: ${body.slug}`, content: base64Utf8(body.content), branch: await resolveBranch(context) };
    if (body.sha) payload.sha = String(body.sha);
    const result = await github(context, `/contents/${encodeURIComponent(path)}`, { method: "PUT", body: JSON.stringify(payload) });
    return apiJson({ ok: true, sha: result.content.sha, commit: result.commit.html_url });
  } catch (error) {
    return apiError(error.message, error.status === 409 || error.status === 422 ? 409 : 502);
  }
}

export async function onRequestDelete(context) {
  const denied = authorize(context, true);
  if (denied) return denied;
  try {
    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("Invalid JSON body");
    const path = articlePath(body.slug);
    if (!path || !/^[0-9a-f]{40}$/.test(body.sha || "")) return apiError("Invalid article or revision");
    const result = await github(context, `/contents/${encodeURIComponent(path)}`, {
      method: "DELETE",
      body: JSON.stringify({ message: `Delete post: ${body.slug}`, sha: body.sha, branch: await resolveBranch(context) }),
    });
    return apiJson({ ok: true, commit: result.commit.html_url });
  } catch (error) {
    return apiError(error.message, error.status === 409 || error.status === 422 ? 409 : 502);
  }
}
