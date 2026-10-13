const ARTICLE_ROOT = "src/data/blog/";
const MEDIA_ROOT = "public/uploads/";

export function apiError(message, status = 400) {
  return Response.json({ error: message }, { status, headers: secureHeaders() });
}

export function apiJson(value, status = 200) {
  return Response.json(value, { status, headers: secureHeaders() });
}

function secureHeaders() {
  return {
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

export function authorize(context, write = false) {
  if (!context.data?.authenticated) return apiError("Unauthorized", 401);
  if (!write) return null;

  const request = context.request;
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (
    origin !== url.origin ||
    (fetchSite && fetchSite !== "same-origin") ||
    request.headers.get("X-Lyrnox-Request") !== "1"
  ) {
    return apiError("Forbidden", 403);
  }
  return null;
}

export function articlePath(slug) {
  if (typeof slug !== "string") return null;
  const normalized = slug.normalize("NFC").trim();
  if (
    !normalized ||
    normalized.length > 120 ||
    normalized.includes("..") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    !/^[\p{L}\p{N}._-]+$/u.test(normalized)
  ) return null;
  const file = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
  return file.startsWith("_") ? null : ARTICLE_ROOT + file;
}

export function mediaPath(name) {
  if (typeof name !== "string") return null;
  const normalized = name.normalize("NFC").trim();
  if (
    !normalized || normalized.length > 140 || normalized.includes("..") ||
    normalized.includes("/") || normalized.includes("\\") ||
    !/^[\p{L}\p{N}._-]+$/u.test(normalized) ||
    !/\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov)$/i.test(normalized)
  ) return null;
  return MEDIA_ROOT + normalized;
}

function config(env) {
  const repo = env.GITHUB_REPO || "your-username/your-repo";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Invalid GITHUB_REPO");
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured");
  return { repo, branch: env.GITHUB_BRANCH || "main", token: env.GITHUB_TOKEN };
}

export async function github(context, endpoint, init = {}) {
  const { repo, token } = config(context.env);
  const response = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "blog-admin",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw Object.assign(new Error(details.message || `GitHub error ${response.status}`), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

export function branch(context) {
  return context.env.GITHUB_BRANCH || "main";
}

// 同步的 branch() 保留给不需要网络的场景；真正调 GitHub API 时用这个，
// 没配 GITHUB_BRANCH 就自动取仓库的默认分支，避免配错分支导致整个后台 404。
let cachedDefaultBranch = null;
export async function resolveBranch(context) {
  if (context.env.GITHUB_BRANCH) return context.env.GITHUB_BRANCH;
  if (cachedDefaultBranch) return cachedDefaultBranch;
  const repo = await github(context, "");
  cachedDefaultBranch = repo.default_branch || "main";
  return cachedDefaultBranch;
}

export function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function utf8Base64(value) {
  const binary = atob(value.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
