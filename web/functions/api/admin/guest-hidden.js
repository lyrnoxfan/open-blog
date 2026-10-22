import { apiError, apiJson, articlePath, authorize, base64Utf8, github, resolveBranch, utf8Base64 } from "./_github.js";

// 「对访客隐藏」名单：只影响访客分站的构建，总站照常显示全部文章。
// 名单存在仓库 src/data/guest-hidden.json（不改文章 frontmatter），改动即提交，Cloudflare 自动重建。
const LIST_PATH = "src/data/guest-hidden.json";

function slugOf(value) {
  const path = articlePath(value);
  return path ? path.slice("src/data/blog/".length, -3) : null;
}

async function readList(context, branch) {
  try {
    const file = await github(context, `/contents/${encodeURIComponent(LIST_PATH)}?ref=${encodeURIComponent(branch)}`);
    const data = JSON.parse(utf8Base64(file.content || ""));
    const hidden = Array.isArray(data?.hidden) ? data.hidden.map(String) : [];
    return { sha: file.sha, hidden };
  } catch (error) {
    if (error.status === 404) return { sha: null, hidden: [] };
    throw error;
  }
}

export async function onRequestGet(context) {
  const denied = authorize(context);
  if (denied) return denied;
  try {
    const { hidden } = await readList(context, await resolveBranch(context));
    return apiJson({ hidden });
  } catch (error) {
    return apiError(error.message, 502);
  }
}

// body: { slug, hidden: boolean, from?: 旧 slug（改名时把隐藏状态带到新 slug） }
export async function onRequestPut(context) {
  const denied = authorize(context, true);
  if (denied) return denied;
  const body = await context.request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.hidden !== "boolean") return apiError("Invalid JSON body");
  const slug = slugOf(body.slug);
  if (!slug) return apiError("Invalid article slug");
  const from = body.from == null ? null : slugOf(body.from);
  if (body.from != null && !from) return apiError("Invalid article slug");
  try {
    const branch = await resolveBranch(context);
    // 并发写入时 sha 冲突：重读后再试一次
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { sha, hidden } = await readList(context, branch);
      const set = new Set(hidden);
      if (from) set.delete(from);
      if (body.hidden) set.add(slug);
      else set.delete(slug);
      const next = [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
      if (next.length === hidden.length && next.every((v, i) => v === [...hidden].sort((a, b) => a.localeCompare(b, "zh-CN"))[i])) {
        return apiJson({ ok: true, hidden: next, unchanged: true });
      }
      const payload = {
        message: `${body.hidden ? "Hide from guests" : "Show to guests"}: ${slug}`,
        content: base64Utf8(`${JSON.stringify({ hidden: next }, null, 2)}\n`),
        branch,
      };
      if (sha) payload.sha = sha;
      try {
        await github(context, `/contents/${encodeURIComponent(LIST_PATH)}`, { method: "PUT", body: JSON.stringify(payload) });
        return apiJson({ ok: true, hidden: next });
      } catch (error) {
        if (attempt === 0 && (error.status === 409 || error.status === 422)) continue;
        throw error;
      }
    }
    return apiError("Conflict", 409);
  } catch (error) {
    return apiError(error.message, error.status === 409 || error.status === 422 ? 409 : 502);
  }
}
