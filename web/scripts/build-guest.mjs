// 访客分站构建：GUEST_BUILD=1 再跑一次 astro build（排除隐藏文章），
// 生成独立的 Pagefind 索引，去掉写作台和与总站重复的公共媒体，最后放进 dist/__guest/。
// 中间件按访客 cookie 把请求改写到 /__guest/*；分站缺失的媒体文件回退到总站同路径。
import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, renameSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "dist-guest";
const TARGET = join("dist", "__guest");
const run = cmd => execSync(cmd, { stdio: "inherit", env: { ...process.env, GUEST_BUILD: "1" } });

rmSync(OUT, { recursive: true, force: true });
run("astro build");

// public/pagefind 可能是总站的索引副本：必须删掉重建，否则会泄露隐藏文章
rmSync(join(OUT, "pagefind"), { recursive: true, force: true });
// 写作台只属于总站
rmSync(join(OUT, "desk"), { recursive: true, force: true });

// 与 public/ 里同路径的文件（图片、视频、音频等）由总站提供，分站不重复上传
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
for (const file of walk("public")) {
  const rel = relative("public", file);
  if (rel.startsWith("pagefind")) continue;
  if (!/\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|m4a|ogg|wav|woff2?|pdf)$/i.test(rel)) continue;
  rmSync(join(OUT, rel), { force: true });
}

run(`pagefind --site ${OUT}`);

rmSync(TARGET, { recursive: true, force: true });
renameSync(OUT, TARGET);
if (!existsSync(join(TARGET, "index.html"))) throw new Error("guest build missing index.html");
process.stdout.write(`guest site -> ${TARGET}\n`);
