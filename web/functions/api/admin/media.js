import { apiError, apiJson, authorize, github, mediaPath, resolveBranch } from "./_github.js";

const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
// 扩展名兜底：移动端选 .mov 时浏览器可能给出空 type 或 application/octet-stream
const EXT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
// 图片 8MB，视频 25MB
const SIZE_LIMIT = type => type.startsWith("video/") ? 25 * 1024 * 1024 : 8 * 1024 * 1024;

export async function onRequestPost(context) {
  const denied = authorize(context, true);
  if (denied) return denied;
  try {
    const form = await context.request.formData().catch(() => null);
    if (!form) return apiError("请选择要上传的文件");
    const file = form.get("file");
    if (!(file instanceof File)) return apiError("请选择要上传的文件");
    const requested = String(form.get("name") || file.name || "");
    const ext = (requested.match(/\.([^.]+)$/) || [])[1];
    const type = TYPES[file.type] ? file.type : EXT_TYPES[String(ext || "").toLowerCase()];
    if (!type || file.size < 1 || file.size > SIZE_LIMIT(type)) return apiError("仅支持 8MB 以内的 PNG、JPEG、GIF、WebP、AVIF 图片，或 25MB 以内的 MP4、WebM、MOV 视频");
    // 按码点截断（Array.from），避免把 CJK 扩展区字符截成半个代理对导致文件名被拒
    const stem = requested.replace(/\.[^.]+$/, "").normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/\.{2,}/g, ".").replace(/^-+|-+$/g, "");
    const safeStem = Array.from(stem).slice(0, 80).join("") || (type.startsWith("video/") ? "video" : "image");
    const name = `${Date.now()}-${safeStem}.${TYPES[type]}`;
    const path = mediaPath(name);
    if (!path) return apiError("Invalid media name");
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 分块直接编码为 base64（块长为 3 的倍数，拼接后与整体编码一致），
    // 不再先拼一整个二进制字符串，降低大视频上传时的内存峰值
    const parts = [];
    for (let i = 0; i < bytes.length; i += 0x6000) parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 0x6000))));
    const content = parts.join("");
    parts.length = 0;
    await github(context, `/contents/${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message: `Upload blog ${type.startsWith("video/") ? "video" : "image"}: ${name}`, content, branch: await resolveBranch(context) }),
    });
    return apiJson({ ok: true, url: `/uploads/${name}` });
  } catch (error) {
    // GitHub 422/409（同名文件已存在等）按冲突返回，其余才算上游故障
    return apiError(error.message, error.status === 409 || error.status === 422 ? 409 : 502);
  }
}
