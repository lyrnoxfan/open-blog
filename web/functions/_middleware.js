const COOKIE_NAME = "__Host-blog_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function secretBytes(secret) {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Uint8Array.from(secret.match(/.{2}/g).map(v => Number.parseInt(v, 16)));
  }
  return encoder.encode(secret);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    secretBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSession(expires, secret) {
  const payload = `v1:${expires}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  );
  return `${expires}.${toBase64Url(sig)}`;
}

async function validSession(token, secret) {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expires = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(token.slice(dot + 1)),
      encoder.encode(`v1:${expires}`)
    );
  } catch {
    return false;
  }
}

async function secureEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function cookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function safeReturnTo(value, origin) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }
  try {
    // WHATWG URL 解析会把反斜杠当斜杠（如 /\evil.example → https://evil.example），
    // 必须用 new URL() 确认最终 origin 仍是本站。
    const base = new URL(origin);
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return "/";
  } catch {
    return "/";
  }
  return value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 一错永封（2026-10-15 用户定版，不设白名单）：密码输错一次，该 IP 永久封禁。
// 封禁名单存 KV 命名空间 AUTH_BANS，键为 ban:<ip>；解封 = 删除对应键。
// KV 是最终一致（全球传播最长约 60 秒），且绑定缺失或 KV 异常时一律放行，
// 绝不因封禁系统自身故障把站锁死。
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP");
}

async function isBanned(env, ip) {
  if (!ip || !env.AUTH_BANS) return false;
  try {
    return (await env.AUTH_BANS.get(`ban:${ip}`)) !== null;
  } catch {
    return false;
  }
}

async function banIp(env, ip, request) {
  if (!ip || !env.AUTH_BANS) return;
  try {
    await env.AUTH_BANS.put(
      `ban:${ip}`,
      JSON.stringify({
        at: new Date().toISOString(),
        ua: request.headers.get("User-Agent") || "",
      })
    );
  } catch {
    // 封禁写入失败不阻断请求处理；本次仍按封禁页回应。
  }
}

function bannedResponse() {
  return new Response("该 IP 已被永久封禁。(IP permanently banned.)", {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

function loginPage(returnTo, error = "") {
  // 信纸风：与主站「藤笺」同一套令牌（暖纸底 / 胶带白卡 / 朱丝内框 / 印章）；只改样式，表单字段不变
  const dateline = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<title>请输入访问密码 | lyrnox's blog</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=Oooh+Baby&display=swap" rel="stylesheet">
<style>
/* 藤笺令牌副本：与 src/styles/tokens.css 保持一致 */
:root{color-scheme:light;--paper:#f3ebdf;--surface:#fffaf3;--ink:#26221d;--ink-soft:#5f574d;--ink-faint:#8a7f72;--rule:#e2d6c4;--rule-strong:#d0c1ab;--wisteria:#67498f;--wisteria-deep:#523677;--wisteria-soft:#e7ddf0;--seal:#a13f04;--tape:rgba(196,176,222,.55);--error:#b3261e;
--serif:"Noto Serif SC","Source Han Serif SC","Songti SC","STSong",Georgia,serif;--sans:system-ui,-apple-system,"PingFang SC","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif;
font-family:var(--sans)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#221a13;--surface:#2c2219;--ink:#f1e7d6;--ink-soft:#c4b49d;--ink-faint:#8f7f6b;--rule:#3e3227;--rule-strong:#524335;--wisteria:#c6b0ea;--wisteria-deep:#ddd0f5;--wisteria-soft:#3b3043;--seal:#e08d4e;--tape:rgba(170,150,200,.3);--error:#f2a093}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased}
.wrap{width:min(92vw,400px);text-align:center}
.dateline{margin:0 0 10px;font-family:"Caveat",var(--serif);font-size:22px;color:var(--ink-soft)}
.card{position:relative;margin-top:26px;padding:36px 26px 26px;border-radius:20px;text-align:center;background:var(--surface);border:1px solid var(--rule);box-shadow:0 2px 3px rgba(111,101,85,.08),0 14px 30px -18px rgba(35,34,31,.3)}
.card::before{content:"";position:absolute;top:-10px;left:50%;transform:translateX(-50%) rotate(-2.5deg);width:88px;height:20px;border-radius:2px;background:var(--tape);box-shadow:0 1px 2px rgba(111,101,85,.15)}
.card::after{content:"";position:absolute;inset:6px;border:1px solid color-mix(in srgb,var(--seal) 22%,transparent);border-radius:15px;pointer-events:none}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 10px;font-size:12px;letter-spacing:.24em;color:var(--ink-soft);font-weight:600;text-transform:uppercase}
.eyebrow::before{content:"爱";display:inline-grid;place-items:center;width:22px;height:22px;border-radius:4px;background:var(--seal);color:var(--paper);font-family:var(--serif);font-size:13px;letter-spacing:0;transform:rotate(-4deg)}
h1{margin:0 0 6px;font-family:Georgia,"Noto Serif","Times New Roman",var(--serif);font-size:30px;font-weight:700;line-height:1.25;letter-spacing:.02em;color:var(--ink)}
.sub{margin:0 0 24px;text-wrap:pretty;font-family:var(--serif);font-size:15px;line-height:1.7;color:var(--ink-soft)}
form{position:relative;z-index:1;text-align:left}
label{display:block;margin:0 0 8px 4px;font-size:13px;font-weight:600;color:var(--ink-soft);letter-spacing:.08em}
input#password{width:100%;height:48px;padding:0 18px;border:1px solid var(--rule-strong);border-radius:999px;background:var(--paper);font:inherit;font-size:16px;color:var(--ink);outline:none;transition:border-color .18s,box-shadow .18s}
input#password::placeholder{color:var(--ink-faint)}
input#password:focus{border-color:var(--wisteria);box-shadow:0 0 0 4px var(--wisteria-soft)}
.error{min-height:20px;margin:10px 4px 0;color:var(--error);font-size:14px;font-weight:600}
button{width:100%;height:48px;margin-top:12px;border:0;border-radius:999px;background:var(--wisteria);color:var(--paper);font:inherit;font-size:16px;font-weight:600;letter-spacing:.1em;cursor:pointer;box-shadow:0 10px 24px -10px rgba(82,54,119,.6);transition:background .18s,transform .18s}
button:hover{background:var(--wisteria-deep)}
button:active{transform:scale(.99)}
button:focus-visible{outline:2px solid var(--wisteria);outline-offset:3px}
.sig{margin:24px 0 0;font-family:"Oooh Baby","Caveat",cursive;font-size:34px;color:var(--seal)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
<p class="dateline">${dateline}</p>
<main class="card">
<p class="eyebrow">Private site</p>
<h1>lyrnox&rsquo;s blog</h1>
<p class="sub">这是一封上锁的信。输入访问密码，即可进入。</p>
<form method="post" action="/__auth" autocomplete="off">
<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
<label for="password">密码</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required maxlength="128" placeholder="输入密码…">
<p class="error" role="alert">${escapeHtml(error)}</p>
<button type="submit">进入网站</button>
</form>
</main>
<p class="sig">&mdash; lyrnox</p>
</div>
</body>
</html>`;
}

function html(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

export async function onRequest({ request, env, next, data }) {
  const url = new URL(request.url);
  const password = env.SITE_PASSWORD;
  const sessionSecret = env.SESSION_SECRET;

  if (!password || !sessionSecret) {
    return new Response("Authentication is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const ip = clientIp(request);
  if (await isBanned(env, ip)) {
    return bannedResponse();
  }

  if (url.pathname === "/__logout") {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (url.pathname === "/__auth") {
    if (request.method !== "POST") {
      return new Response(null, { status: 303, headers: { Location: "/" } });
    }

    const form = await request.formData();
    const submitted = String(form.get("password") || "");
    const returnTo = safeReturnTo(String(form.get("returnTo") || "/"), url.origin);

    if (
      submitted.length < 1 ||
      submitted.length > 128 ||
      !(await secureEqual(submitted, password))
    ) {
      await banIp(env, ip, request);
      return bannedResponse();
    }

    const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    const token = await createSession(expires, sessionSecret);

    return new Response(null, {
      status: 303,
      headers: {
        Location: returnTo,
        "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (await validSession(cookie(request, COOKIE_NAME), sessionSecret)) {
    // Pages Functions below the middleware must still explicitly require this
    // marker. This gives sensitive API routes defence in depth instead of
    // relying only on their position in the routing tree.
    data.authenticated = true;
    const response = await next();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return html(loginPage(`${url.pathname}${url.search}`));
}
