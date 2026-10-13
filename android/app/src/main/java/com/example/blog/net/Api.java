package com.example.blog.net;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** 写作后台 /api/admin/articles 的原生客户端。写操作必须带 Origin + X-Lyrnox-Request 头。 */
public class Api {

    public static class ApiException extends Exception {
        public final int status;
        public ApiException(int status, String msg) {
            super(msg);
            this.status = status;
        }
    }

    public static class ArticleContent {
        public final String slug;
        public final String sha;
        public final String content;
        public ArticleContent(String slug, String sha, String content) {
            this.slug = slug;
            this.sha = sha;
            this.content = content;
        }
    }

    private static HttpURLConnection open(String cookie, String method, String path) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(Auth.SITE + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        c.setRequestProperty("Cookie", cookie);
        if ("PUT".equals(method) || "DELETE".equals(method) || "POST".equals(method)) {
            c.setRequestProperty("Origin", Auth.SITE);
            c.setRequestProperty("X-Lyrnox-Request", "1");
            c.setDoOutput(true);
        }
        if ("PUT".equals(method) || "DELETE".equals(method)) {
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        }
        return c;
    }

    private static String readBody(HttpURLConnection c) throws Exception {
        InputStream in;
        try {
            in = c.getInputStream();
        } catch (Exception e) {
            in = c.getErrorStream();
            if (in == null) return "";
        }
        try (InputStream autoClose = in;
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = autoClose.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void checkOk(HttpURLConnection c, String body) throws ApiException {
        int code;
        try {
            code = c.getResponseCode();
        } catch (Exception e) {
            throw new ApiException(-1, "网络错误");
        }
        if (code < 200 || code >= 300) {
            String msg = body;
            try {
                msg = new JSONObject(body).optString("error", body);
            } catch (Exception ignored) {
            }
            throw new ApiException(code, msg);
        }
    }

    /** 返回 slug -> sha（服务端最新列表）。lite=1 轻量模式：服务端一次 GitHub 调用，同步专用。 */
    public static Map<String, String> getArticleList(String cookie) throws Exception {
        HttpURLConnection c = open(cookie, "GET", "/api/admin/articles?lite=1");
        String body = readBody(c);
        checkOk(c, body);
        Map<String, String> result = new LinkedHashMap<>();
        JSONArray arr = new JSONObject(body).getJSONArray("articles");
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            result.put(o.getString("slug"), o.getString("sha"));
        }
        return result;
    }

    public static ArticleContent getArticle(String cookie, String slug) throws Exception {
        String path = "/api/admin/articles?slug=" + URLEncoder.encode(slug, StandardCharsets.UTF_8);
        HttpURLConnection c = open(cookie, "GET", path);
        String body = readBody(c);
        checkOk(c, body);
        JSONObject o = new JSONObject(body);
        return new ArticleContent(o.getString("slug"), o.getString("sha"), o.getString("content"));
    }

    /** 成功返回新的 sha；sha 为 null 表示新建。 */
    public static String putArticle(String cookie, String slug, String sha, String content) throws Exception {
        HttpURLConnection c = open(cookie, "PUT", "/api/admin/articles");
        JSONObject payload = new JSONObject();
        payload.put("slug", slug);
        if (sha != null) payload.put("sha", sha);
        payload.put("content", content);
        byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = c.getOutputStream()) {
            os.write(bytes);
        }
        String body = readBody(c);
        checkOk(c, body);
        return new JSONObject(body).getString("sha");
    }

    public static void deleteArticle(String cookie, String slug, String sha) throws Exception {
        HttpURLConnection c = open(cookie, "DELETE", "/api/admin/articles");
        JSONObject payload = new JSONObject();
        payload.put("slug", slug);
        payload.put("sha", sha);
        byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = c.getOutputStream()) {
            os.write(bytes);
        }
        String body = readBody(c);
        checkOk(c, body);
    }

    public interface ProgressCallback {
        void onProgress(int percent);
    }

    /**
     * 上传图片/视频到 /api/admin/media，成功返回相对路径（如 /uploads/xxx.jpg）。
     * 服务端限制：图片 8MB 内，视频 25MB 内。
     */
    public static String uploadMedia(String cookie, String displayName, String mimeType,
                                     byte[] data, ProgressCallback progress) throws Exception {
        String boundary = "----BlogApk" + System.currentTimeMillis();
        HttpURLConnection c = open(cookie, "POST", "/api/admin/media");
        c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

        byte[] head = ("--" + boundary + "\r\n" +
                "Content-Disposition: form-data; name=\"name\"\r\n\r\n" +
                displayName + "\r\n" +
                "--" + boundary + "\r\n" +
                "Content-Disposition: form-data; name=\"file\"; filename=\"upload\"\r\n" +
                "Content-Type: " + mimeType + "\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
        c.setFixedLengthStreamingMode(head.length + data.length + tail.length);

        try (OutputStream os = c.getOutputStream()) {
            os.write(head);
            int chunk = 32768;
            int written = 0;
            int lastPct = -1;
            while (written < data.length) {
                int n = Math.min(chunk, data.length - written);
                os.write(data, written, n);
                written += n;
                if (progress != null) {
                    int pct = (int) (written * 100L / data.length);
                    if (pct != lastPct) {
                        lastPct = pct;
                        progress.onProgress(pct);
                    }
                }
            }
            os.write(tail);
        }
        String body = readBody(c);
        checkOk(c, body);
        return new JSONObject(body).getString("url");
    }
}
