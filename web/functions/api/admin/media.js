import { apiError, apiJson, authorize, github, mediaPath, resolveBranch } from "./_github.js";

const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
// 图片 8MB，视频 25MB
const SIZE_LIMIT = type => type.startsWith("video/") ? 25 * 1024 * 1024 : 8 * 1024 * 1024;

export async function onRequestPost(context) {
  const denied = authorize(context, true);
  if (denied) return denied;
  try {
    const form = await context.request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !TYPES[file.type] || file.size < 1 || file.size > SIZE_LIMIT(file.type)) return apiError("仅支持 8MB 以内的 PNG、JPEG、GIF、WebP、AVIF 图片，或 25MB 以内的 MP4、WebM、MOV 视频");
    const requested = String(form.get("name") || file.name).replace(/\.[^.]+$/, "") || "image";
    const safeStem = requested.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
    const name = `${Date.now()}-${safeStem}.${TYPES[file.type]}`;
    const path = mediaPath(name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await github(context, `/contents/${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message: `Upload blog ${file.type.startsWith("video/") ? "video" : "image"}: ${name}`, content: btoa(binary), branch: await resolveBranch(context) }),
    });
    return apiJson({ ok: true, url: `/uploads/${name}` });
  } catch (error) {
    return apiError(error.message, 502);
  }
}
