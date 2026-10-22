// Cloudflare Workers 免费版限制打包体积 1 MiB。这几个依赖在 Workers 里本来就跑不起来，
// 部署前清空它们的入口文件，把体积压到限制以内（上游 twikoo-cloudflare 的官方做法）。
import { writeFileSync, existsSync } from "node:fs";

const files = [
  "node_modules/jsdom/lib/api.js",
  "node_modules/tencentcloud-sdk-nodejs/tencentcloud/index.js",
  "node_modules/nodemailer/lib/nodemailer.js",
];

for (const f of files) {
  if (existsSync(f)) {
    writeFileSync(f, "");
    console.log(`trimmed ${f}`);
  }
}
