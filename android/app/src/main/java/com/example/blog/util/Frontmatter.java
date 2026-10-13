package com.example.blog.util;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Markdown frontmatter 解析 / 拼装（与网页写作台规则保持一致）。 */
public class Frontmatter {

    public static class Parsed {
        public final List<String> headerLines = new ArrayList<>();
        public String body = "";
        public boolean hasFrontmatter = false;
    }

    private static final Pattern FRONTMATTER = Pattern.compile("\\A---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?");

    public static Parsed parse(String content) {
        Parsed p = new Parsed();
        if (content == null) return p;
        Matcher m = FRONTMATTER.matcher(content);
        if (m.find()) {
            p.hasFrontmatter = true;
            String header = m.group(1);
            for (String line : header.split("\\r?\\n")) {
                if (!line.trim().isEmpty()) p.headerLines.add(line);
            }
            p.body = content.substring(m.end());
        } else {
            p.body = content;
        }
        return p;
    }

    private static String fieldValue(List<String> lines, String key) {
        Pattern pat = Pattern.compile("^" + Pattern.quote(key) + ":\\s*(.*)$");
        for (String line : lines) {
            Matcher m = pat.matcher(line.trim());
            if (m.find()) return unquote(m.group(1).trim());
        }
        return "";
    }

    private static String unquote(String v) {
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            try {
                // JSON 转义与网页端 quote() 对应
                return v.substring(1, v.length() - 1)
                        .replace("\\\"", "\"").replace("\\\\", "\\").replace("\\n", "\n");
            } catch (Exception ignored) {
            }
        }
        return v;
    }

    private static String quote(String v) {
        return "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }

    public static String getTitle(Parsed p) {
        return fieldValue(p.headerLines, "title");
    }

    public static String getDescription(Parsed p) {
        return fieldValue(p.headerLines, "description");
    }

    public static String getPubDatetime(Parsed p) {
        return fieldValue(p.headerLines, "pubDatetime");
    }

    public static boolean getDraft(Parsed p) {
        return "true".equalsIgnoreCase(fieldValue(p.headerLines, "draft"));
    }

    public static boolean getPinned(Parsed p) {
        return "true".equalsIgnoreCase(fieldValue(p.headerLines, "pinned"));
    }

    /** 解析 tags：支持 flow 写法 tags: ["a", "b"] 与 block 写法 */
    public static List<String> getTags(Parsed p) {
        List<String> out = new ArrayList<>();
        List<String> lines = p.headerLines;
        for (int i = 0; i < lines.size(); i++) {
            String t = lines.get(i).trim();
            if (!t.startsWith("tags:")) continue;
            String rest = t.substring(5).trim();
            if (rest.startsWith("[")) {
                String inner = rest.replaceAll("^\\[", "").replaceAll("\\]$", "");
                for (String part : inner.split(",")) {
                    String v = part.trim();
                    if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) v = unquote(v);
                    else v = v.replaceAll("^[\"']|[\"']$", "");
                    if (!v.isEmpty()) out.add(v);
                }
            } else if (rest.isEmpty()) {
                for (int j = i + 1; j < lines.size(); j++) {
                    String lt = lines.get(j).trim();
                    if (!lt.startsWith("- ")) break;
                    String v = lt.substring(2).trim().replaceAll("^[\"']|[\"']$", "");
                    if (!v.isEmpty()) out.add(v);
                }
            } else {
                String v = unquote(rest);
                if (!v.isEmpty()) out.add(v);
            }
            break;
        }
        return out;
    }

    private static String toJsonArray(List<String> tags) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        if (tags != null) {
            for (String t : tags) {
                if (t == null) continue;
                String v = t.trim();
                if (v.isEmpty()) continue;
                if (!first) sb.append(",");
                sb.append(quote(v));
                first = false;
            }
        }
        sb.append("]");
        return sb.toString();
    }

    private static String isoNow() {
        java.text.SimpleDateFormat f =
                new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return f.format(new java.util.Date());
    }

    /**
     * 拼装保存用的完整 markdown。
     * @param original 原解析结果（新建时传 parse("")）
     * @param wasDraft 打开时原文件是否为草稿（决定是否写 modDatetime，与网页端一致）
     */
    public static String build(Parsed original, String title, String description,
                               List<String> tags, boolean pinned,
                               boolean draft, String body, boolean isNew, boolean wasDraft) {
        List<String> kept = new ArrayList<>();
        boolean inTagsBlock = false;
        for (String line : original.headerLines) {
            String t = line.trim();
            // tags 由编辑器统一接管：过滤 tags 行及其 block 续行，避免重复
            if (t.startsWith("tags:") && t.substring(5).trim().isEmpty()) {
                inTagsBlock = true;
                continue;
            }
            if (inTagsBlock && t.startsWith("- ")) continue;
            inTagsBlock = false;
            if (t.startsWith("title:") || t.startsWith("description:") || t.startsWith("draft:")
                    || t.startsWith("modDatetime:") || t.startsWith("pubDatetime:")
                    || t.startsWith("tags:") || t.startsWith("pinned:")) {
                continue;
            }
            kept.add(line);
        }
        List<String> h = new ArrayList<>();
        h.add("title: " + quote(title));
        h.add("description: " + quote(description));
        h.add("tags: " + toJsonArray(tags));
        if (isNew) {
            h.add("pubDatetime: " + isoNow());
        } else {
            String pub = fieldValue(original.headerLines, "pubDatetime");
            h.add("pubDatetime: " + (pub.isEmpty() ? isoNow() : pub));
            // 只有「已发布的文章被再次保存」才算更新；草稿首次发布不写 modDatetime
            if (!wasDraft) h.add("modDatetime: " + isoNow());
        }
        h.add("draft: " + draft);
        if (pinned) h.add("pinned: true");
        h.addAll(kept);
        return "---\n" + String.join("\n", h) + "\n---\n\n" + body.replaceAll("^\\s+", "");
    }

    /** 由标题生成 slug：日期前缀 + 标题精简，兼容服务端 ^[\p{L}\p{N}._-]+$ 规则。 */
    public static String slugify(String title) {
        java.text.SimpleDateFormat f =
                new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
        String date = f.format(new java.util.Date());
        String s = title.toLowerCase(java.util.Locale.US)
                .replaceAll("[^\\p{L}\\p{N}]+", "-")
                .replaceAll("^-+|-+$", "");
        if (s.length() > 50) s = s.substring(0, 50).replaceAll("-+$", "");
        if (s.isEmpty()) s = String.valueOf(System.currentTimeMillis() / 1000);
        return date + "-" + s;
    }

    /** 中日韩逐字 + 英文按词，约数（与网站统计口径接近）。 */
    public static int countWords(String s) {
        if (s == null || s.isEmpty()) return 0;
        int cjk = 0;
        Matcher m = Pattern.compile("[\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF]").matcher(s);
        while (m.find()) cjk++;
        String rest = s.replaceAll("[\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF]", " ");
        int words = 0;
        for (String w : rest.trim().split("\\s+")) {
            if (!w.isEmpty() && w.matches(".*[A-Za-z0-9].*")) words++;
        }
        return cjk + words;
    }
}
