const COOKIE_NAME = "__Host-blog_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_WINDOW = 10 * 60;
const RATE_LIMIT_BLOCK = 15 * 60;
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

function safeReturnTo(value) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sha256Hex(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value))
  );
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function rateLimitKey(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  const ipHash = await sha256Hex(ip);
  return new Request(`https://rate-limit.invalid/auth/${ipHash}`, { method: "GET" });
}

async function readRateLimit(request) {
  const key = await rateLimitKey(request);
  if (!key) return { key: null, state: null };

  try {
    const cached = await caches.default.match(key);
    if (!cached) return { key, state: null };
    const state = await cached.json();
    return { key, state };
  } catch {
    return { key, state: null };
  }
}

async function writeRateLimit(key, state, ttl) {
  if (!key) return;
  try {
    await caches.default.put(
      key,
      new Response(JSON.stringify(state), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${Math.max(1, Math.ceil(ttl))}`,
        },
      })
    );
  } catch {
    // Do not lock out the site if the edge cache is unavailable.
  }
}

async function clearRateLimit(key) {
  if (!key) return;
  try {
    await caches.default.delete(key);
  } catch {
    // Non-fatal: an expired failure counter is harmless.
  }
}

async function getRateLimitStatus(request) {
  const now = Math.floor(Date.now() / 1000);
  const { key, state } = await readRateLimit(request);

  if (!state) {
    return {
      key,
      now,
      failures: 0,
      windowStart: now,
      blockedUntil: 0,
    };
  }

  if (Number(state.blockedUntil) > now) {
    return {
      key,
      now,
      failures: Number(state.failures) || RATE_LIMIT_MAX_FAILURES,
      windowStart: Number(state.windowStart) || now,
      blockedUntil: Number(state.blockedUntil),
    };
  }

  if (now - Number(state.windowStart || 0) >= RATE_LIMIT_WINDOW) {
    return {
      key,
      now,
      failures: 0,
      windowStart: now,
      blockedUntil: 0,
    };
  }

  return {
    key,
    now,
    failures: Number(state.failures) || 0,
    windowStart: Number(state.windowStart) || now,
    blockedUntil: 0,
  };
}

async function recordFailedAttempt(status) {
  const failures = status.failures + 1;
  const shouldBlock = failures >= RATE_LIMIT_MAX_FAILURES;
  const blockedUntil = shouldBlock ? status.now + RATE_LIMIT_BLOCK : 0;
  const state = {
    failures,
    windowStart: status.windowStart,
    blockedUntil,
  };
  const ttl = shouldBlock
    ? RATE_LIMIT_BLOCK
    : Math.max(1, RATE_LIMIT_WINDOW - (status.now - status.windowStart));

  await writeRateLimit(status.key, state, ttl);
  return { shouldBlock, blockedUntil };
}

function loginPage(returnTo, error = "") {
  // 飘落的樱花 / 爱心装饰（纯 CSS 动画）
  const petals = ["🌸", "🌸", "💗", "🌸", "✿", "💖", "🌸", "💗", "✿", "🌸", "💗", "🌸"]
    .map((p, i) => {
      const left = (i * 37 + 5) % 100;
      const size = 13 + ((i * 7) % 15);
      const dur = 9 + ((i * 5) % 9);
      const delay = -((i * 1.9) % 12);
      return `<span style="left:${left}vw;font-size:${size}px;animation-duration:${dur}s;animation-delay:${delay}s">${p}</span>`;
    })
    .join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<title>请输入访问密码 ♡</title>
<style>
:root{color-scheme:light;font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;color:#3b3b6d;overflow:hidden;
background:linear-gradient(135deg,#bfdbfe 0%,#fbcfe8 55%,#f9a8d4 100%)}
.bg{position:fixed;inset:0;z-index:0;background:url("https://loliapi.com/acg") center/cover no-repeat}
.veil{position:fixed;inset:0;z-index:1;background:linear-gradient(135deg,rgba(191,219,254,.42),rgba(249,168,212,.40) 60%,rgba(196,181,253,.38))}
.petals{position:fixed;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.petals span{position:absolute;top:-48px;animation-name:fall;animation-timing-function:linear;animation-iteration-count:infinite;filter:drop-shadow(0 2px 4px rgba(0,0,0,.12))}
@keyframes fall{to{transform:translateY(112vh) rotate(340deg)}}
.card{position:relative;z-index:2;width:min(92vw,400px);padding:32px 28px 28px;border-radius:26px;text-align:center;
background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(16px) saturate(1.25);backdrop-filter:blur(16px) saturate(1.25);
border:1px solid rgba(255,255,255,.7);box-shadow:0 24px 70px rgba(168,85,247,.28),0 6px 20px rgba(37,99,235,.14)}
.eyebrow{margin:0 0 6px;font-size:12px;letter-spacing:.28em;color:#ec4899;font-weight:700}
h1{margin:0 0 6px;font-size:26px;font-weight:800;background:linear-gradient(115deg,#2563eb 10%,#a855f7 50%,#ec4899 90%);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{margin:0 0 20px;font-size:13.5px;color:#8b8ba7}
form{text-align:left}
label{display:block;margin:0 0 8px 2px;font-size:13px;font-weight:600;color:#6d6da0}
input#password{width:100%;height:48px;padding:0 16px;border:2px solid #fbcfe8;border-radius:16px;background:rgba(255,255,255,.92);font:inherit;font-size:16px;color:#3b3b6d;outline:none;transition:border-color .2s,box-shadow .2s}
input#password::placeholder{color:#c4b5fd}
input#password:focus{border-color:#f472b6;box-shadow:0 0 0 4px rgba(244,114,182,.18)}
.error{min-height:20px;margin:10px 2px 0;color:#e11d48;font-size:13px;font-weight:600}
button{width:100%;height:48px;margin-top:16px;border:0;border-radius:999px;background:linear-gradient(120deg,#60a5fa,#f472b6);color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(244,114,182,.35);transition:transform .15s,box-shadow .15s}
button:hover{transform:translateY(-1px) scale(1.01);box-shadow:0 12px 28px rgba(244,114,182,.45)}
button:active{transform:scale(.99)}
.refresh{position:fixed;z-index:2;bottom:18px;left:50%;transform:translateX(-50%);font-size:12.5px;color:#fff;text-decoration:none;background:rgba(255,255,255,.25);border:1px solid rgba(255,255,255,.5);padding:8px 16px;border-radius:999px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.refresh:hover{background:rgba(255,255,255,.42)}
@media (prefers-reduced-motion:reduce){.petals{display:none}}
</style>
</head>
<body>
<div class="bg" aria-hidden="true"></div>
<div class="veil" aria-hidden="true"></div>
<div class="petals" aria-hidden="true">${petals}</div>
<main class="card">
<p class="eyebrow">✦ Private site ✦</p>
<h1>请输入访问密码</h1>
<p class="sub">通过验证后即可进入小站 ♡</p>
<form method="post" action="/__auth" autocomplete="off">
<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
<label for="password">密码</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required maxlength="128" placeholder="输入密码…">
<p class="error" role="alert">${escapeHtml(error)}</p>
<button type="submit">进入网站 ♡</button>
</form>
</main>
<a class="refresh" href="">↻ 换一张背景</a>
</body>
</html>`;
}

function html(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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
    const returnTo = safeReturnTo(String(form.get("returnTo") || "/"));
    const rateLimit = await getRateLimitStatus(request);

    if (rateLimit.blockedUntil > rateLimit.now) {
      const retryAfter = rateLimit.blockedUntil - rateLimit.now;
      return html(
        loginPage(returnTo, `尝试次数过多，请在 ${Math.ceil(retryAfter / 60)} 分钟后再试。`),
        429,
        { "Retry-After": String(retryAfter) }
      );
    }

    if (
      submitted.length < 1 ||
      submitted.length > 128 ||
      !(await secureEqual(submitted, password))
    ) {
      const failed = await recordFailedAttempt(rateLimit);
      if (failed.shouldBlock) {
        return html(
          loginPage(returnTo, "尝试次数过多，请在 15 分钟后再试。"),
          429,
          { "Retry-After": String(RATE_LIMIT_BLOCK) }
        );
      }
      return html(loginPage(returnTo, "密码不正确，请再试一次。"), 401);
    }

    await clearRateLimit(rateLimit.key);

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
