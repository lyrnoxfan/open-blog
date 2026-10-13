package com.example.blog.util;

import android.content.Context;

import com.example.blog.net.Auth;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 文章图片磁盘缓存：同步时预下载，阅读器离线也能显示图片。
 * 文件名 = url 的 SHA-1，存放在内部存储 article_images/ 下。
 */
public class ImageCache {

    private static final long MAX_BYTES = 8L * 1024 * 1024;

    private static final Pattern MD_IMAGE =
            Pattern.compile("!\\[[^\\]]*\\]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)");
    private static final Pattern HTML_IMG =
            Pattern.compile("<img[^>]+src=[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE);

    /** 把相对路径补成绝对 URL；返回 null 表示不是可缓存的图片地址。 */
    public static String normalize(String raw) {
        if (raw == null) return null;
        raw = raw.trim();
        if (raw.isEmpty() || raw.startsWith("data:") || raw.startsWith("file:")
                || raw.startsWith("android-")) return null;
        if (raw.startsWith("//")) return "https:" + raw;
        if (raw.startsWith("/")) return Auth.SITE + raw;
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
        return null;
    }

    /** 从 markdown 正文里提取所有图片 URL（去重、绝对化）。 */
    public static List<String> extractUrls(String markdown) {
        Set<String> out = new LinkedHashSet<>();
        if (markdown == null) return new ArrayList<>(out);
        Matcher m = MD_IMAGE.matcher(markdown);
        while (m.find()) {
            String u = normalize(m.group(1));
            if (u != null) out.add(u);
        }
        Matcher h = HTML_IMG.matcher(markdown);
        while (h.find()) {
            String u = normalize(h.group(1));
            if (u != null) out.add(u);
        }
        return new ArrayList<>(out);
    }

    private static String sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format(Locale.US, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(s.hashCode());
        }
    }

    private static String extOf(String url) {
        String path = url.split("\\?")[0].toLowerCase(Locale.US);
        int dot = path.lastIndexOf('.');
        if (dot > 0 && path.length() - dot <= 5) {
            String e = path.substring(dot + 1);
            if (e.matches("png|jpe?g|gif|webp|avif|bmp")) return "." + e;
        }
        return ".img";
    }

    public static File fileFor(Context context, String url) {
        File dir = new File(context.getFilesDir(), "article_images");
        return new File(dir, sha1(url) + extOf(url));
    }

    public static boolean isCached(Context context, String url) {
        return fileFor(context, url).exists();
    }

    /**
     * 取图片文件：有缓存直接返回；无缓存且在线则下载（带登录 Cookie，站内图片要过密码网关）。
     * 失败返回 null。
     */
    public static File fetch(Context context, String url, String cookie) {
        File f = fileFor(context, url);
        if (f.exists()) return f;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "lyrnox-blog-apk");
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) return null;
            long len = c.getContentLengthLong();
            if (len > MAX_BYTES) return null;
            File dir = f.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();
            File tmp = new File(dir, f.getName() + ".tmp");
            try (InputStream in = c.getInputStream();
                 FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[32768];
                int n;
                long total = 0;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) {
                        tmp.delete();
                        return null;
                    }
                    out.write(buf, 0, n);
                }
            }
            if (!tmp.renameTo(f)) {
                tmp.delete();
                return null;
            }
            return f;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
