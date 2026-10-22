# Twikoo 评论后端（Cloudflare Workers + D1 + R2）

基于 [twikoo-cloudflare](https://github.com/twikoojs/twikoo-cloudflare)，MIT 许可。

```bash
npm install
npx wrangler login
npx wrangler d1 create twikoo     # 把 database_id 填进 wrangler.toml
npm run db:init
npx wrangler r2 bucket create twikoo
npm run deploy
```

完整步骤见仓库根目录 README 的「评论（Twikoo）」一节。
