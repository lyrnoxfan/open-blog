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

// 访客分站会话：同一个 cookie 名、同一把密钥，但签名内容前缀不同（g1:），
// 以 "g" 开头的令牌 validSession 解析不出数字直接拒绝，访客令牌无法冒充总站会话。
async function createGuestSession(expires, secret) {
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`g1:${expires}`))
  );
  return `g${expires}.${toBase64Url(sig)}`;
}

async function validGuestSession(token, secret) {
  if (!token || token[0] !== "g") return false;
  const dot = token.indexOf(".");
  if (dot <= 1) return false;
  const expires = Number(token.slice(1, dot));
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(token.slice(dot + 1)),
      encoder.encode(`g1:${expires}`)
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

// 永封名单（2026-10-15 起的一错永封记录；2026-10-22 起输错改为进访客分站，不再新增封禁）。
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

// 口令输错不再封禁，而是悄悄进访客分站（2026-10-22 用户定版，方案 A）。
// 防暴力猜测：同一 IP 一小时内输错满 5 次，之后 24 小时内即使口令正确也只进分站，
// 攻击者无法通过「进了哪个站」判断猜没猜中。计数存同一个 AUTH_BANS 命名空间
//（fail:<ip>:<小时>、lock:<ip>），带 TTL 自动过期；KV 缺失或异常时不限速（与封禁一致，故障放行）。
// 已存在的 ban:<ip> 永封记录仍然生效。
const FAIL_LIMIT = 5;
const LOCK_SECONDS = 24 * 60 * 60;

async function isLocked(env, ip) {
  if (!ip || !env.AUTH_BANS) return false;
  try {
    return (await env.AUTH_BANS.get(`lock:${ip}`)) !== null;
  } catch {
    return false;
  }
}

async function recordFailure(env, ip) {
  if (!ip || !env.AUTH_BANS) return;
  try {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key = `fail:${ip}:${hour}`;
    const count = Number((await env.AUTH_BANS.get(key)) || 0) + 1;
    await env.AUTH_BANS.put(key, String(count), { expirationTtl: 7200 });
    if (count >= FAIL_LIMIT) {
      await env.AUTH_BANS.put(`lock:${ip}`, new Date().toISOString(), {
        expirationTtl: LOCK_SECONDS,
      });
    }
  } catch {
    // 计数失败不影响本次请求
  }
}

// 访客分站的静态文件在 /__guest/ 下；与总站共用的公共媒体（图片/视频等）分站不重复存放，
// 找不到时回退到总站同路径。文章 OG 图（/index.png）不回退，避免隐藏文章的封面图被取到。
const GUEST_PREFIX = "/__guest";
async function serveGuest(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const target = new URL(url);
  target.pathname = GUEST_PREFIX + url.pathname;
  let response = await env.ASSETS.fetch(new Request(target, request));
  if (
    response.status === 404 &&
    !url.pathname.startsWith("/_astro/") &&
    !url.pathname.endsWith("/index.png") &&
    STATIC_MEDIA.test(url.pathname)
  ) {
    response = await env.ASSETS.fetch(new Request(url, request));
  }
  const headers = new Headers(response.headers);
  // 目录补斜杠等跳转：去掉内部前缀，访客看到的网址与总站一致
  const location = headers.get("Location");
  if (location) {
    const loc = new URL(location, url);
    if (loc.origin === url.origin && loc.pathname.startsWith(GUEST_PREFIX)) {
      loc.pathname = loc.pathname.slice(GUEST_PREFIX.length) || "/";
      headers.set("Location", `${loc.pathname}${loc.search}${loc.hash}`);
    }
  }
  headers.set("Cache-Control", cacheControlFor(url.pathname, response.status));
  headers.set("Strict-Transport-Security", HSTS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bannedResponse() {
  return new Response("该 IP 已被永久封禁。(IP permanently banned.)", {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

// 密码页顶部的一枝紫藤（静态内联 SVG：CSP 为 default-src 'none'，不能引外部图片）
// 由主站 Wisteria 组件同一套生长算法固定种子生成，颜色走下方 --w0…--w4 令牌
const SPRIG_SVG = `<svg class="sprig" viewBox="0 0 160 96" aria-hidden="true"><path class="v" d="M3 12C40 4 64 18 96 10S140 6 157 13"/><path class="v2" d="M3 14C42 8 66 21 98 13S141 10 157 15"/><g transform="translate(8 10.8) rotate(35)"><path class="r" d="M0 0Q13 1.5 26 0"/><ellipse class="l1" cx="8.9" cy="-3" rx="6" ry="2.1" transform="rotate(-46 5.7 0)"/><ellipse class="l2" cx="8.9" cy="3" rx="6" ry="2.1" transform="rotate(46 5.7 0)"/><ellipse class="l2" cx="14.3" cy="-2.7" rx="5.4" ry="1.9" transform="rotate(-46 11.3 0)"/><ellipse class="l1" cx="14.3" cy="2.7" rx="5.4" ry="1.9" transform="rotate(46 11.3 0)"/><ellipse class="l1" cx="19.6" cy="-2.4" rx="4.9" ry="1.8" transform="rotate(-46 17 0)"/><ellipse class="l2" cx="19.6" cy="2.4" rx="4.9" ry="1.8" transform="rotate(46 17 0)"/><ellipse class="l2" cx="25" cy="-2.2" rx="4.3" ry="1.6" transform="rotate(-46 22.6 0)"/><ellipse class="l1" cx="25" cy="2.2" rx="4.3" ry="1.6" transform="rotate(46 22.6 0)"/><ellipse class="l1" cx="31" cy="0" rx="6" ry="2.2"/></g><g transform="translate(44 8) rotate(148)"><path class="r" d="M0 0Q13 1.5 26 0"/><ellipse class="l1" cx="8.9" cy="-3" rx="6" ry="2.1" transform="rotate(-46 5.7 0)"/><ellipse class="l2" cx="8.9" cy="3" rx="6" ry="2.1" transform="rotate(46 5.7 0)"/><ellipse class="l2" cx="14.3" cy="-2.7" rx="5.4" ry="1.9" transform="rotate(-46 11.3 0)"/><ellipse class="l1" cx="14.3" cy="2.7" rx="5.4" ry="1.9" transform="rotate(46 11.3 0)"/><ellipse class="l1" cx="19.6" cy="-2.4" rx="4.9" ry="1.8" transform="rotate(-46 17 0)"/><ellipse class="l2" cx="19.6" cy="2.4" rx="4.9" ry="1.8" transform="rotate(46 17 0)"/><ellipse class="l2" cx="25" cy="-2.2" rx="4.3" ry="1.6" transform="rotate(-46 22.6 0)"/><ellipse class="l1" cx="25" cy="2.2" rx="4.3" ry="1.6" transform="rotate(46 22.6 0)"/><ellipse class="l1" cx="31" cy="0" rx="6" ry="2.2"/></g><g transform="translate(104 15.2) rotate(32)"><path class="r" d="M0 0Q13 1.5 26 0"/><ellipse class="l1" cx="8.9" cy="-3" rx="6" ry="2.1" transform="rotate(-46 5.7 0)"/><ellipse class="l2" cx="8.9" cy="3" rx="6" ry="2.1" transform="rotate(46 5.7 0)"/><ellipse class="l2" cx="14.3" cy="-2.7" rx="5.4" ry="1.9" transform="rotate(-46 11.3 0)"/><ellipse class="l1" cx="14.3" cy="2.7" rx="5.4" ry="1.9" transform="rotate(46 11.3 0)"/><ellipse class="l1" cx="19.6" cy="-2.4" rx="4.9" ry="1.8" transform="rotate(-46 17 0)"/><ellipse class="l2" cx="19.6" cy="2.4" rx="4.9" ry="1.8" transform="rotate(46 17 0)"/><ellipse class="l2" cx="25" cy="-2.2" rx="4.3" ry="1.6" transform="rotate(-46 22.6 0)"/><ellipse class="l1" cx="25" cy="2.2" rx="4.3" ry="1.6" transform="rotate(46 22.6 0)"/><ellipse class="l1" cx="31" cy="0" rx="6" ry="2.2"/></g><g transform="translate(152 13.2) rotate(150)"><path class="r" d="M0 0Q13 1.5 26 0"/><ellipse class="l1" cx="8.9" cy="-3" rx="6" ry="2.1" transform="rotate(-46 5.7 0)"/><ellipse class="l2" cx="8.9" cy="3" rx="6" ry="2.1" transform="rotate(46 5.7 0)"/><ellipse class="l2" cx="14.3" cy="-2.7" rx="5.4" ry="1.9" transform="rotate(-46 11.3 0)"/><ellipse class="l1" cx="14.3" cy="2.7" rx="5.4" ry="1.9" transform="rotate(46 11.3 0)"/><ellipse class="l1" cx="19.6" cy="-2.4" rx="4.9" ry="1.8" transform="rotate(-46 17 0)"/><ellipse class="l2" cx="19.6" cy="2.4" rx="4.9" ry="1.8" transform="rotate(46 17 0)"/><ellipse class="l2" cx="25" cy="-2.2" rx="4.3" ry="1.6" transform="rotate(-46 22.6 0)"/><ellipse class="l1" cx="25" cy="2.2" rx="4.3" ry="1.6" transform="rotate(46 22.6 0)"/><ellipse class="l1" cx="31" cy="0" rx="6" ry="2.2"/></g><g transform="translate(30 8.3)"><path class="s" d="M0 0Q-1.3 30 -0.5 60"/><ellipse class="t3 f" cx="-1.1" cy="35.6" rx="2.6" ry="2.1" transform="rotate(-5 -1.1 36)"/><ellipse class="t1 k f" cx="-1.1" cy="37.1" rx="1.3" ry="0.9" transform="rotate(-5 -1.1 36)"/><ellipse class="b f" cx="-0.3" cy="57.3" rx="1.3" ry="1.7" transform="rotate(-3.4 -0.3 57.3)"/><ellipse class="t1 f" cx="-2.6" cy="14.1" rx="3.6" ry="2.9" transform="rotate(1.2 -2.6 14.7)"/><ellipse class="t0 k f" cx="-2.6" cy="16.2" rx="1.8" ry="1.3" transform="rotate(1.2 -2.6 14.7)"/><ellipse class="t2 f" cx="1.4" cy="22.2" rx="3.3" ry="2.6" transform="rotate(14 1.4 22.7)"/><ellipse class="t0 k f" cx="1.4" cy="24.1" rx="1.6" ry="1.2" transform="rotate(14 1.4 22.7)"/><ellipse class="t4 f" cx="-1.9" cy="49" rx="2.4" ry="1.9" transform="rotate(-13.2 -1.9 49.3)"/><ellipse class="t2 k f" cx="-1.9" cy="50.3" rx="1.2" ry="0.9" transform="rotate(-13.2 -1.9 49.3)"/><ellipse class="t3 f" cx="1.1" cy="43.6" rx="2.6" ry="2.1" transform="rotate(22.7 1.1 44)"/><ellipse class="t1 k f" cx="1.1" cy="45.1" rx="1.3" ry="0.9" transform="rotate(22.7 1.1 44)"/><ellipse class="t2 f" cx="-3.9" cy="27.5" rx="3.2" ry="2.6" transform="rotate(-25.1 -3.9 28)"/><ellipse class="t0 k f" cx="-3.9" cy="29.4" rx="1.6" ry="1.2" transform="rotate(-25.1 -3.9 28)"/><ellipse class="t1 f" cx="3.9" cy="8.8" rx="3.6" ry="2.9" transform="rotate(22 3.9 9.3)"/><ellipse class="t0 k f" cx="3.9" cy="10.8" rx="1.8" ry="1.3" transform="rotate(22 3.9 9.3)"/><ellipse class="t1" cx="-4.9" cy="6.1" rx="4.1" ry="3.2" transform="rotate(-40.4 -4.9 6.7)"/><ellipse class="t0 k" cx="-4.9" cy="8.4" rx="2" ry="1.5" transform="rotate(-40.4 -4.9 6.7)"/><ellipse class="t2" cx="3.1" cy="30.2" rx="3.2" ry="2.6" transform="rotate(20.4 3.1 30.7)"/><ellipse class="t0 k" cx="3.1" cy="32" rx="1.6" ry="1.2" transform="rotate(20.4 3.1 30.7)"/><ellipse class="t3" cx="-3.7" cy="40.9" rx="2.7" ry="2.1" transform="rotate(-17.5 -3.7 41.3)"/><ellipse class="t1 k" cx="-3.7" cy="42.5" rx="1.3" ry="1" transform="rotate(-17.5 -3.7 41.3)"/><ellipse class="t4" cx="1.2" cy="51.7" rx="2.1" ry="1.7" transform="rotate(24.4 1.2 52)"/><ellipse class="t2 k" cx="1.2" cy="52.9" rx="1" ry="0.8" transform="rotate(24.4 1.2 52)"/><ellipse class="t2" cx="-4.6" cy="19.4" rx="3.8" ry="3" transform="rotate(-35.1 -4.6 20)"/><ellipse class="t0 k" cx="-4.6" cy="21.6" rx="1.9" ry="1.4" transform="rotate(-35.1 -4.6 20)"/><ellipse class="t1" cx="4.3" cy="16.8" rx="3.4" ry="2.8" transform="rotate(16 4.3 17.3)"/><ellipse class="t0 k" cx="4.3" cy="18.8" rx="1.7" ry="1.2" transform="rotate(16 4.3 17.3)"/><ellipse class="b" cx="-1.9" cy="54.7" rx="1.3" ry="1.7" transform="rotate(-32.8 -1.9 54.7)"/><ellipse class="t3" cx="1.3" cy="38.3" rx="2.7" ry="2.2" transform="rotate(7.9 1.3 38.7)"/><ellipse class="t1 k" cx="1.3" cy="39.8" rx="1.4" ry="1" transform="rotate(7.9 1.3 38.7)"/><ellipse class="t2" cx="-2.8" cy="32.9" rx="3.2" ry="2.6" transform="rotate(-10.4 -2.8 33.3)"/><ellipse class="t0 k" cx="-2.8" cy="34.7" rx="1.6" ry="1.2" transform="rotate(-10.4 -2.8 33.3)"/><ellipse class="t1" cx="3.5" cy="3.4" rx="3.8" ry="3" transform="rotate(17.4 3.5 4)"/><ellipse class="t0 k" cx="3.5" cy="5.6" rx="1.9" ry="1.4" transform="rotate(17.4 3.5 4)"/><ellipse class="b" cx="-0" cy="60" rx="1.3" ry="1.7" transform="rotate(1.4 -0 60)"/><ellipse class="t2" cx="-1.7" cy="11.5" rx="3.6" ry="2.9" transform="rotate(-4.5 -1.7 12)"/><ellipse class="t0 k" cx="-1.7" cy="13.5" rx="1.8" ry="1.3" transform="rotate(-4.5 -1.7 12)"/><ellipse class="t2" cx="0.3" cy="24.9" rx="3.1" ry="2.5" transform="rotate(12.6 0.3 25.3)"/><ellipse class="t0 k" cx="0.3" cy="26.6" rx="1.5" ry="1.1" transform="rotate(12.6 0.3 25.3)"/><ellipse class="t3" cx="-0.9" cy="46.3" rx="2.7" ry="2.1" transform="rotate(-2.9 -0.9 46.7)"/><ellipse class="t1 k" cx="-0.9" cy="47.8" rx="1.3" ry="1" transform="rotate(-2.9 -0.9 46.7)"/></g><g transform="translate(58 9)"><path class="s" d="M0 0Q0.5 40 0.2 80"/><ellipse class="t3 f" cx="0.5" cy="50.7" rx="3.3" ry="2.7" transform="rotate(2.4 0.5 51.2)"/><ellipse class="t1 k f" cx="0.5" cy="52.6" rx="1.7" ry="1.2" transform="rotate(2.4 0.5 51.2)"/><ellipse class="t1 f" cx="1.8" cy="16.4" rx="4.4" ry="3.5" transform="rotate(12.4 1.8 17.1)"/><ellipse class="t0 k f" cx="1.8" cy="19" rx="2.2" ry="1.6" transform="rotate(12.4 1.8 17.1)"/><ellipse class="t2 f" cx="-1.1" cy="29.6" rx="3.7" ry="3" transform="rotate(-21.5 -1.1 30.2)"/><ellipse class="t0 k f" cx="-1.1" cy="31.8" rx="1.9" ry="1.3" transform="rotate(-21.5 -1.1 30.2)"/><ellipse class="b f" cx="1" cy="72.1" rx="1.5" ry="2" transform="rotate(15.2 1 72.1)"/><ellipse class="t4 f" cx="-1" cy="63.9" rx="2.6" ry="2.1" transform="rotate(-1.5 -1 64.3)"/><ellipse class="t2 k f" cx="-1" cy="65.4" rx="1.3" ry="1" transform="rotate(-1.5 -1 64.3)"/><ellipse class="t2 f" cx="2.9" cy="37.5" rx="3.6" ry="2.9" transform="rotate(4.6 2.9 38.1)"/><ellipse class="t0 k f" cx="2.9" cy="39.6" rx="1.8" ry="1.3" transform="rotate(4.6 2.9 38.1)"/><ellipse class="t1 f" cx="-3.6" cy="8.6" rx="4.3" ry="3.4" transform="rotate(-24.4 -3.6 9.2)"/><ellipse class="t0 k f" cx="-3.6" cy="11" rx="2.1" ry="1.5" transform="rotate(-24.4 -3.6 9.2)"/><ellipse class="t1 f" cx="5.7" cy="3.2" rx="5.1" ry="4.1" transform="rotate(14.6 5.7 4)"/><ellipse class="t0 k f" cx="5.7" cy="6.2" rx="2.6" ry="1.8" transform="rotate(14.6 5.7 4)"/><ellipse class="t2 f" cx="-2.5" cy="42.7" rx="3.7" ry="3" transform="rotate(-20.5 -2.5 43.3)"/><ellipse class="t0 k f" cx="-2.5" cy="44.9" rx="1.9" ry="1.3" transform="rotate(-20.5 -2.5 43.3)"/><ellipse class="t3 f" cx="2.6" cy="58.6" rx="2.9" ry="2.3" transform="rotate(19 2.6 59)"/><ellipse class="t1 k f" cx="2.6" cy="60.2" rx="1.4" ry="1" transform="rotate(19 2.6 59)"/><ellipse class="b f" cx="-1" cy="77.4" rx="1.4" ry="1.8" transform="rotate(-33.7 -1 77.4)"/><ellipse class="t2 f" cx="4.8" cy="24.4" rx="3.6" ry="2.9" transform="rotate(17.8 4.8 25)"/><ellipse class="t0 k f" cx="4.8" cy="26.5" rx="1.8" ry="1.3" transform="rotate(17.8 4.8 25)"/><ellipse class="t2 f" cx="-5" cy="21.7" rx="4" ry="3.2" transform="rotate(-37.3 -5 22.3)"/><ellipse class="t0 k f" cx="-5" cy="24" rx="2" ry="1.5" transform="rotate(-37.3 -5 22.3)"/><ellipse class="b" cx="1.2" cy="80" rx="1.4" ry="1.9" transform="rotate(40.3 1.2 80)"/><ellipse class="t3" cx="-3" cy="55.9" rx="3.2" ry="2.5" transform="rotate(-18.8 -3 56.4)"/><ellipse class="t1 k" cx="-3" cy="57.7" rx="1.6" ry="1.1" transform="rotate(-18.8 -3 56.4)"/><ellipse class="t3" cx="4.3" cy="45.5" rx="3" ry="2.4" transform="rotate(28.8 4.3 45.9)"/><ellipse class="t1 k" cx="4.3" cy="47.2" rx="1.5" ry="1.1" transform="rotate(28.8 4.3 45.9)"/><ellipse class="t1" cx="6.6" cy="11.2" rx="4.2" ry="3.4" transform="rotate(13.7 6.6 11.9)"/><ellipse class="t0 k" cx="6.6" cy="13.6" rx="2.1" ry="1.5" transform="rotate(13.7 6.6 11.9)"/><ellipse class="t3" cx="-4.2" cy="34.9" rx="3.4" ry="2.7" transform="rotate(-17.6 -4.2 35.4)"/><ellipse class="t1 k" cx="-4.2" cy="36.9" rx="1.7" ry="1.2" transform="rotate(-17.6 -4.2 35.4)"/><ellipse class="t3" cx="2.6" cy="66.5" rx="2.5" ry="2" transform="rotate(18.8 2.6 66.9)"/><ellipse class="t1 k" cx="2.6" cy="68" rx="1.3" ry="0.9" transform="rotate(18.8 2.6 66.9)"/><ellipse class="b" cx="-1.5" cy="69.5" rx="1.4" ry="1.9" transform="rotate(-22 -1.5 69.5)"/><ellipse class="t2" cx="4.6" cy="32.3" rx="3.5" ry="2.8" transform="rotate(17.2 4.6 32.8)"/><ellipse class="t0 k" cx="4.6" cy="34.3" rx="1.7" ry="1.2" transform="rotate(17.2 4.6 32.8)"/><ellipse class="t1" cx="-5.1" cy="13.8" rx="4.5" ry="3.6" transform="rotate(-11 -5.1 14.5)"/><ellipse class="t0 k" cx="-5.1" cy="16.4" rx="2.2" ry="1.6" transform="rotate(-11 -5.1 14.5)"/><ellipse class="t3" cx="-2.6" cy="48" rx="3.4" ry="2.7" transform="rotate(-26.7 -2.6 48.6)"/><ellipse class="t1 k" cx="-2.6" cy="50" rx="1.7" ry="1.2" transform="rotate(-26.7 -2.6 48.6)"/><ellipse class="t3" cx="2.3" cy="53.4" rx="2.9" ry="2.3" transform="rotate(26.5 2.3 53.8)"/><ellipse class="t1 k" cx="2.3" cy="55" rx="1.4" ry="1" transform="rotate(26.5 2.3 53.8)"/><ellipse class="t2" cx="3.2" cy="19.1" rx="4.5" ry="3.6" transform="rotate(23.2 3.2 19.7)"/><ellipse class="t0 k" cx="3.2" cy="21.6" rx="2.2" ry="1.6" transform="rotate(23.2 3.2 19.7)"/><ellipse class="t2" cx="-2" cy="27.1" rx="3.5" ry="2.8" transform="rotate(-26 -2 27.6)"/><ellipse class="t0 k" cx="-2" cy="29.1" rx="1.8" ry="1.3" transform="rotate(-26 -2 27.6)"/><ellipse class="b" cx="0.7" cy="74.8" rx="1.5" ry="2" transform="rotate(20.8 0.7 74.8)"/><ellipse class="t3" cx="-0.3" cy="61.3" rx="2.6" ry="2.1" transform="rotate(-13.1 -0.3 61.7)"/><ellipse class="t1 k" cx="-0.3" cy="62.8" rx="1.3" ry="0.9" transform="rotate(-13.1 -0.3 61.7)"/><ellipse class="t2" cx="0.8" cy="40.2" rx="3.3" ry="2.6" transform="rotate(12.6 0.8 40.7)"/><ellipse class="t0 k" cx="0.8" cy="42.1" rx="1.7" ry="1.2" transform="rotate(12.6 0.8 40.7)"/><ellipse class="t1" cx="-0.6" cy="5.9" rx="5.1" ry="4" transform="rotate(10.2 -0.6 6.6)"/><ellipse class="t0 k" cx="-0.6" cy="8.7" rx="2.5" ry="1.8" transform="rotate(10.2 -0.6 6.6)"/></g><g transform="translate(88 13.2)"><path class="s" d="M0 0Q-0.8 33 -0.3 66"/><ellipse class="t3 f" cx="-0" cy="30.5" rx="2.9" ry="2.4" transform="rotate(-11.1 -0 31)"/><ellipse class="t1 k f" cx="-0" cy="32.2" rx="1.5" ry="1.1" transform="rotate(-11.1 -0 31)"/><ellipse class="b f" cx="-0.4" cy="66" rx="1.3" ry="1.7" transform="rotate(-6.1 -0.4 66)"/><ellipse class="t1 f" cx="-1.7" cy="8.8" rx="4.1" ry="3.3" transform="rotate(-11.1 -1.7 9.4)"/><ellipse class="t0 k f" cx="-1.7" cy="11.1" rx="2" ry="1.5" transform="rotate(-11.1 -1.7 9.4)"/><ellipse class="t4 f" cx="0.6" cy="52.2" rx="2.2" ry="1.8" transform="rotate(13.9 0.6 52.5)"/><ellipse class="t2 k f" cx="0.6" cy="53.5" rx="1.1" ry="0.8" transform="rotate(13.9 0.6 52.5)"/><ellipse class="t3 f" cx="-1.9" cy="44" rx="2.6" ry="2.1" transform="rotate(-9.4 -1.9 44.4)"/><ellipse class="t1 k f" cx="-1.9" cy="45.5" rx="1.3" ry="0.9" transform="rotate(-9.4 -1.9 44.4)"/><ellipse class="t1 f" cx="3.1" cy="17" rx="3.4" ry="2.7" transform="rotate(10.4 3.1 17.5)"/><ellipse class="t0 k f" cx="3.1" cy="18.9" rx="1.7" ry="1.2" transform="rotate(10.4 3.1 17.5)"/><ellipse class="t2 f" cx="-3.4" cy="22.3" rx="3.8" ry="3" transform="rotate(-24.5 -3.4 22.9)"/><ellipse class="t0 k f" cx="-3.4" cy="24.5" rx="1.9" ry="1.4" transform="rotate(-24.5 -3.4 22.9)"/><ellipse class="t3 f" cx="2.1" cy="38.6" rx="2.9" ry="2.3" transform="rotate(16.8 2.1 39)"/><ellipse class="t1 k f" cx="2.1" cy="40.3" rx="1.5" ry="1" transform="rotate(16.8 2.1 39)"/><ellipse class="b f" cx="-1.9" cy="57.9" rx="1.3" ry="1.7" transform="rotate(-36 -1.9 57.9)"/><ellipse class="t1 f" cx="6" cy="3.4" rx="3.9" ry="3.1" transform="rotate(16 6 4)"/><ellipse class="t0 k f" cx="6" cy="5.6" rx="1.9" ry="1.4" transform="rotate(16 6 4)"/><ellipse class="b" cx="1.2" cy="60.6" rx="1.4" ry="1.8" transform="rotate(17.7 1.2 60.6)"/><ellipse class="t3" cx="-3.9" cy="35.9" rx="3" ry="2.4" transform="rotate(-26 -3.9 36.3)"/><ellipse class="t1 k" cx="-3.9" cy="37.6" rx="1.5" ry="1.1" transform="rotate(-26 -3.9 36.3)"/><ellipse class="t2" cx="4.1" cy="25" rx="3.7" ry="2.9" transform="rotate(25.8 4.1 25.6)"/><ellipse class="t0 k" cx="4.1" cy="27.1" rx="1.8" ry="1.3" transform="rotate(25.8 4.1 25.6)"/><ellipse class="t2" cx="-5.4" cy="14.2" rx="4.1" ry="3.3" transform="rotate(-29.5 -5.4 14.8)"/><ellipse class="t0 k" cx="-5.4" cy="16.5" rx="2.1" ry="1.5" transform="rotate(-29.5 -5.4 14.8)"/><ellipse class="t3" cx="2.1" cy="46.7" rx="2.7" ry="2.1" transform="rotate(24.8 2.1 47.1)"/><ellipse class="t1 k" cx="2.1" cy="48.3" rx="1.3" ry="1" transform="rotate(24.8 2.1 47.1)"/><ellipse class="t4" cx="-2.8" cy="49.4" rx="2.7" ry="2.2" transform="rotate(-20.4 -2.8 49.8)"/><ellipse class="t2 k" cx="-2.8" cy="51" rx="1.4" ry="1" transform="rotate(-20.4 -2.8 49.8)"/><ellipse class="t1" cx="3.9" cy="11.6" rx="3.4" ry="2.8" transform="rotate(36.6 3.9 12.1)"/><ellipse class="t0 k" cx="3.9" cy="13.5" rx="1.7" ry="1.2" transform="rotate(36.6 3.9 12.1)"/><ellipse class="t2" cx="-3.6" cy="27.8" rx="3.3" ry="2.6" transform="rotate(-20.2 -3.6 28.3)"/><ellipse class="t0 k" cx="-3.6" cy="29.6" rx="1.6" ry="1.2" transform="rotate(-20.2 -3.6 28.3)"/><ellipse class="t2" cx="1.6" cy="33.2" rx="3" ry="2.4" transform="rotate(23.1 1.6 33.7)"/><ellipse class="t0 k" cx="1.6" cy="34.9" rx="1.5" ry="1.1" transform="rotate(23.1 1.6 33.7)"/><ellipse class="b" cx="-1.1" cy="63.3" rx="1.1" ry="1.5" transform="rotate(-5.7 -1.1 63.3)"/><ellipse class="t1" cx="-3.1" cy="6" rx="4.3" ry="3.5" transform="rotate(-23.1 -3.1 6.7)"/><ellipse class="t0 k" cx="-3.1" cy="8.5" rx="2.2" ry="1.6" transform="rotate(-23.1 -3.1 6.7)"/><ellipse class="t3" cx="0.2" cy="54.9" rx="2.1" ry="1.7" transform="rotate(-2.6 0.2 55.2)"/><ellipse class="t1 k" cx="0.2" cy="56.1" rx="1" ry="0.8" transform="rotate(-2.6 0.2 55.2)"/><ellipse class="t3" cx="-1.4" cy="41.3" rx="2.8" ry="2.2" transform="rotate(-5.9 -1.4 41.7)"/><ellipse class="t1 k" cx="-1.4" cy="42.9" rx="1.4" ry="1" transform="rotate(-5.9 -1.4 41.7)"/><ellipse class="t2" cx="0" cy="19.6" rx="3.6" ry="2.9" transform="rotate(-4.6 0 20.2)"/><ellipse class="t0 k" cx="0" cy="21.7" rx="1.8" ry="1.3" transform="rotate(-4.6 0 20.2)"/></g><g transform="translate(122 16)"><path class="s" d="M0 0Q3.1 26 1.2 52"/><ellipse class="t1 f" cx="1.1" cy="16.8" rx="3.7" ry="3" transform="rotate(-7.9 1.1 17.3)"/><ellipse class="t0 k f" cx="1.1" cy="18.9" rx="1.9" ry="1.3" transform="rotate(-7.9 1.1 17.3)"/><ellipse class="b f" cx="1" cy="52" rx="1.1" ry="1.5" transform="rotate(-7.5 1 52)"/><ellipse class="t3 f" cx="2.5" cy="38.3" rx="2.3" ry="1.9" transform="rotate(-4.3 2.5 38.7)"/><ellipse class="t1 k f" cx="2.5" cy="39.6" rx="1.2" ry="0.8" transform="rotate(-4.3 2.5 38.7)"/><ellipse class="t1 f" cx="2.6" cy="3.4" rx="4.1" ry="3.3" transform="rotate(14.2 2.6 4)"/><ellipse class="t0 k f" cx="2.6" cy="5.7" rx="2" ry="1.5" transform="rotate(14.2 2.6 4)"/><ellipse class="t3 f" cx="0.2" cy="30.2" rx="3.1" ry="2.5" transform="rotate(-28.4 0.2 30.7)"/><ellipse class="t1 k f" cx="0.2" cy="32" rx="1.6" ry="1.1" transform="rotate(-28.4 0.2 30.7)"/><ellipse class="t2 f" cx="4.4" cy="24.9" rx="2.8" ry="2.3" transform="rotate(26.6 4.4 25.3)"/><ellipse class="t0 k f" cx="4.4" cy="26.5" rx="1.4" ry="1" transform="rotate(26.6 4.4 25.3)"/><ellipse class="t1 f" cx="-3.8" cy="8.8" rx="3.9" ry="3.1" transform="rotate(-36.6 -3.8 9.3)"/><ellipse class="t0 k f" cx="-3.8" cy="11" rx="1.9" ry="1.4" transform="rotate(-36.6 -3.8 9.3)"/><ellipse class="t3 f" cx="-0.1" cy="43.7" rx="2.1" ry="1.7" transform="rotate(-30.2 -0.1 44)"/><ellipse class="t1 k f" cx="-0.1" cy="44.9" rx="1" ry="0.8" transform="rotate(-30.2 -0.1 44)"/><ellipse class="b f" cx="3.1" cy="46.7" rx="1.2" ry="1.6" transform="rotate(32.8 3.1 46.7)"/><ellipse class="t2" cx="6" cy="11.4" rx="3.8" ry="3" transform="rotate(15.5 6 12)"/><ellipse class="t0 k" cx="6" cy="13.6" rx="1.9" ry="1.4" transform="rotate(15.5 6 12)"/><ellipse class="t2" cx="-2.1" cy="22.1" rx="3.6" ry="2.9" transform="rotate(-26 -2.1 22.7)"/><ellipse class="t0 k" cx="-2.1" cy="24.2" rx="1.8" ry="1.3" transform="rotate(-26 -2.1 22.7)"/><ellipse class="t3" cx="4.8" cy="32.9" rx="2.7" ry="2.1" transform="rotate(28.9 4.8 33.3)"/><ellipse class="t1 k" cx="4.8" cy="34.5" rx="1.3" ry="1" transform="rotate(28.9 4.8 33.3)"/><ellipse class="t3" cx="-0.4" cy="35.6" rx="2.4" ry="1.9" transform="rotate(-23.4 -0.4 36)"/><ellipse class="t1 k" cx="-0.4" cy="37" rx="1.2" ry="0.9" transform="rotate(-23.4 -0.4 36)"/><ellipse class="t2" cx="4.5" cy="19.4" rx="3.7" ry="3" transform="rotate(28.9 4.5 20)"/><ellipse class="t0 k" cx="4.5" cy="21.6" rx="1.9" ry="1.3" transform="rotate(28.9 4.5 20)"/><ellipse class="t1" cx="-2.2" cy="14.1" rx="4" ry="3.2" transform="rotate(-28.9 -2.2 14.7)"/><ellipse class="t0 k" cx="-2.2" cy="16.4" rx="2" ry="1.5" transform="rotate(-28.9 -2.2 14.7)"/><ellipse class="b" cx="0.8" cy="49.3" rx="1.2" ry="1.6" transform="rotate(-0.6 0.8 49.3)"/><ellipse class="t3" cx="2.7" cy="41" rx="2.3" ry="1.8" transform="rotate(19.3 2.7 41.3)"/><ellipse class="t1 k" cx="2.7" cy="42.3" rx="1.1" ry="0.8" transform="rotate(19.3 2.7 41.3)"/><ellipse class="t1" cx="1.5" cy="6.1" rx="3.9" ry="3.1" transform="rotate(12.5 1.5 6.7)"/><ellipse class="t0 k" cx="1.5" cy="8.3" rx="1.9" ry="1.4" transform="rotate(12.5 1.5 6.7)"/><ellipse class="t3" cx="1.4" cy="27.5" rx="3.3" ry="2.6" transform="rotate(0.3 1.4 28)"/><ellipse class="t1 k" cx="1.4" cy="29.4" rx="1.7" ry="1.2" transform="rotate(0.3 1.4 28)"/></g></svg>`;

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
<title>凭口令入 | My Blog · 藤笺</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=Noto+Serif+SC:wght@500;700&family=Oooh+Baby&display=swap" rel="stylesheet">
<style>
/* 藤笺令牌副本：与 src/styles/tokens.css 保持一致 */
:root{color-scheme:light;--paper:#f3ebdf;--surface:#fffaf3;--ink:#26221d;--ink-soft:#5f574d;--ink-faint:#8a7f72;--rule:#e2d6c4;--rule-strong:#d0c1ab;--wisteria:#67498f;--wisteria-deep:#523677;--wisteria-soft:#e7ddf0;--seal:#a13f04;--tape:rgba(196,176,222,.55);--error:#b3261e;
--w0:#5d4291;--w1:#7b5fb3;--w2:#9a82c9;--w3:#bba9dd;--w4:#dcd0ee;--bud:#c9cfae;--vine:#7a6a58;--leaf:#7c8c63;--leaf-2:#9aa97f;
--serif:"Noto Serif SC","Source Han Serif SC","Songti SC","STSong",Georgia,serif;--sans:system-ui,-apple-system,"PingFang SC","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif;
font-family:var(--sans)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#1f1810;--paper-deep:#271e15;--surface:#2a2017;--ink:#ece1cc;--ink-soft:#b6a78f;--ink-faint:#847561;--rule:#382c20;--rule-strong:#4a3a2b;--wisteria:#b8a3df;--wisteria-deep:#cab6f0;--wisteria-soft:#3a2f3f;--wisteria-mist:#2b2326;--seal:#d9884a;--seal-soft:#432e1d;--tape:rgba(170,150,200,.28);--error:#f2a093;--candle:rgba(255,200,120,.06);--lines:rgba(217,136,74,.07);--w0:#7a6db0;--w1:#8e7cbf;--w2:#8676b3;--w3:#6b5f93;--w4:#4d456b;--bud:#4c523c;--vine:#5a4c3b;--leaf:#576245;--leaf-2:#475033}}
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
h1{margin:0 0 6px;font-family:var(--serif);font-size:30px;font-weight:700;line-height:1.25;letter-spacing:.02em;color:var(--ink)}
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
.sprig{display:block;width:150px;height:auto;margin:-6px auto 4px;overflow:visible}
.sprig .v{fill:none;stroke:var(--vine);stroke-width:2.6;stroke-linecap:round;opacity:.75}
.sprig .v2{fill:none;stroke:var(--vine);stroke-width:1.2;stroke-linecap:round;opacity:.5}
.sprig .s,.sprig .r{fill:none;stroke:var(--leaf);stroke-width:.8;opacity:.6}
.sprig .t0{fill:var(--w0)}.sprig .t1{fill:var(--w1)}.sprig .t2{fill:var(--w2)}.sprig .t3{fill:var(--w3)}.sprig .t4{fill:var(--w4)}
.sprig .b{fill:color-mix(in srgb,var(--w4) 55%,var(--bud))}.sprig .k{opacity:.85}.sprig .f{opacity:.62}
.sprig .l1{fill:var(--leaf);opacity:.75}.sprig .l2{fill:var(--leaf-2);opacity:.75}
.sig{margin:24px 0 0;font-family:"Oooh Baby","Caveat",cursive;font-size:34px;color:var(--seal)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
${SPRIG_SVG}
<p class="dateline">${dateline}</p>
<main class="card">
<p class="eyebrow">私笺</p>
<h1>My Blog · 藤笺</h1>
<p class="sub">此笺有锁，凭口令可入。</p>
<form method="post" action="/__auth" autocomplete="off">
<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
<label for="password">口令</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required maxlength="128" placeholder="输入口令…">
<p class="error" role="alert">${escapeHtml(error)}</p>
<button type="submit">启封</button>
</form>
</main>
<p class="sig">&mdash; your-name</p>
</div>
</body>
</html>`;
}

function logoutPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>退出登录 · 藤笺</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3ebdf;color:#26221d;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:320px;margin:16px;padding:32px 28px;background:#fbf7ee;border:1px solid #ddd0ba;border-radius:16px;text-align:center}
h1{font-size:20px;margin:0 0 8px}
p{margin:0 0 20px;font-size:14px;line-height:1.7;color:#5c5546}
button{width:100%;height:44px;border:0;border-radius:999px;background:#a94432;color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer}
a{display:inline-block;margin-top:14px;font-size:14px;color:#67498f}
</style>
</head>
<body>
<main>
<h1>退出登录</h1>
<p>退出后，本设备将需要重新输入口令才能阅读。</p>
<form method="post" action="/__logout">
<button type="submit">确认退出</button>
</form>
<a href="/">暂不退出</a>
</main>
</body>
</html>`;
}

// 仅加 HSTS，不含 includeSubDomains/preload，避免影响 example.com 其他子域
const HSTS = "max-age=31536000";

// 登录后的缓存策略（只影响浏览器缓存，始终 private，CDN 不缓存；鉴权逻辑不变）：
// - /_astro/* 文件名带内容哈希，可长期缓存
// - 图片/视频/音频/字体：一天
// - 其余（HTML、API、RSS、搜索索引等）保持 no-store
const STATIC_MEDIA = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|woff2?)$/i;
function cacheControlFor(pathname, status) {
  // 206（视频拖动的分段响应）与 304（重新验证）沿用对应资源的缓存策略
  if (status !== 200 && status !== 206 && status !== 304) return "private, no-store";
  if (pathname.startsWith("/_astro/")) return "private, max-age=31536000, immutable";
  if (!pathname.startsWith("/api/") && STATIC_MEDIA.test(pathname)) return "private, max-age=86400";
  return "private, no-store";
}

function html(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      // Cloudflare Web Analytics 会自动往页面里注入统计脚本：放行它（script-src）和本域上报端点 /cdn-cgi/rum（connect-src 'self'）
      "Content-Security-Policy": "default-src 'none'; script-src https://static.cloudflareinsights.com; connect-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Strict-Transport-Security": HSTS,
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
    if (request.method === "POST") {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) {
        return new Response("Forbidden", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/",
          "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }
    return html(logoutPage());
  }

  if (url.pathname === "/__auth") {
    if (request.method !== "POST") {
      return new Response(null, { status: 303, headers: { Location: "/" } });
    }

    // 挡跨站伪造的登录提交：否则任何外站页面都能替访客提交错误口令，让访客 IP 被一次性永封。
    // 用 Sec-Fetch-Site 而不是 Origin：登录页是 no-referrer，同源表单提交的 Origin 也是 "null"。
    // 本站提交为 same-origin，原生 App / 老浏览器不带此头，均不受影响；被挡的请求不计入封禁。
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    if (fetchSite === "cross-site" || fetchSite === "same-site") {
      return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    const form = await request.formData();
    const submitted = String(form.get("password") || "");
    const returnTo = safeReturnTo(String(form.get("returnTo") || "/"), url.origin);

    const correct =
      submitted.length >= 1 &&
      submitted.length <= 128 &&
      (await secureEqual(submitted, password));
    if (!correct) await recordFailure(env, ip);
    const toMain = correct && !(await isLocked(env, ip));

    // 口令错误（或该 IP 处于限速期）：不提示，发访客会话进分站
    const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    const token = toMain
      ? await createSession(expires, sessionSecret)
      : await createGuestSession(expires, sessionSecret);

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
    headers.set("Cache-Control", cacheControlFor(url.pathname, response.status));
    headers.set("Strict-Transport-Security", HSTS);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (await validGuestSession(cookie(request, COOKIE_NAME), sessionSecret)) {
    // 访客只能拿到分站静态文件：不进入 next()，写作台与 /api/* 均不可达
    return serveGuest(request, env, url);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return html(loginPage(`${url.pathname}${url.search}`));
}
