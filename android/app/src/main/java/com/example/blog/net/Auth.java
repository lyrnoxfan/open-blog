package com.example.blog.net;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** 密码网关登录：POST /__auth 换取 __Host-blog_session Cookie。
 *  注意：密码直接 baked 进 APK，勿将含真实密码的包公开发布。 */
public class Auth {
    public static final String SITE = "https://your-blog.example.com"; // 换成你的博客地址
    public static final String SITE_PASSWORD = "your-site-password"; // 换成你的站点密码
    public static final String COOKIE_NAME = "__Host-blog_session";

    /** 成功返回 "name=value" 形式的 Cookie，失败返回 null。 */
    public static String loginAndGetCookie() {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(SITE + "/__auth").openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            String body = "password=" + URLEncoder.encode(SITE_PASSWORD, StandardCharsets.UTF_8)
                    + "&returnTo=" + URLEncoder.encode("/", StandardCharsets.UTF_8);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            conn.setRequestProperty("Content-Length", String.valueOf(bytes.length));
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
            int code = conn.getResponseCode();
            if (code != 303 && code != 302) return null;
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) {
                    for (String sc : e.getValue()) {
                        if (sc.startsWith(COOKIE_NAME + "=")) {
                            return sc.split(";", 2)[0];
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }
}
