package com.example.blog;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.Toast;

import com.example.blog.db.ArticleDb;
import com.example.blog.net.Auth;
import com.example.blog.sync.SyncManager;
import com.example.blog.util.EdgeToEdge;
import com.example.blog.util.Frontmatter;
import com.example.blog.util.ImageCache;

import java.io.File;
import java.io.FileInputStream;
import java.util.Arrays;
import java.util.Collection;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import io.noties.markwon.Markwon;
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin;
import io.noties.markwon.ext.tables.TablePlugin;
import io.noties.markwon.image.ImageItem;
import io.noties.markwon.image.ImagesPlugin;
import io.noties.markwon.image.SchemeHandler;

/**
 * 原生文章阅读器：正文走本地数据库 + Markwon 原生渲染，全离线可读。
 * 图片走磁盘缓存（同步时预下载），离线也能显示；在线时未缓存的图片会自动下载。
 */
public class ReaderActivity extends Activity {

    private static final Pattern VIDEO_TAG = Pattern.compile(
            "<video[^>]*?src=[\"']([^\"']+)[\"'][^>]*?(?:/>|>\\s*</video>)",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private ArticleDb db;
    private String slug;
    private volatile String imageCookie;
    private Markwon markwon;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_reader);
        EdgeToEdge.apply(this);
        db = new ArticleDb(this);

        slug = getIntent().getStringExtra("slug");
        if (slug == null) {
            finish();
            return;
        }

        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_edit).setOnClickListener(v -> {
            Intent i = new Intent(this, EditorActivity.class);
            i.putExtra("slug", slug);
            startActivity(i);
        });

        markwon = Markwon.builder(this)
                .usePlugin(StrikethroughPlugin.create())
                .usePlugin(TablePlugin.create(this))
                .usePlugin(ImagesPlugin.create()
                        .removeSchemeHandler("http")
                        .removeSchemeHandler("https")
                        .addSchemeHandler(cachedSchemeHandler()))
                .build();

        loadArticle();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 从编辑器返回时正文可能变了，重新加载
        loadArticle();
    }

    @Override
    protected void onDestroy() {
        db.close();
        super.onDestroy();
    }

    private void loadArticle() {
        TextView topTitle = findViewById(R.id.top_title);
        TextView titleView = findViewById(R.id.article_title);
        TextView metaView = findViewById(R.id.article_meta);
        TextView descView = findViewById(R.id.article_desc);
        TextView bodyView = findViewById(R.id.article_body);

        new Thread(() -> {
            ArticleDb.Row row = db.get(slug);
            if (row == null || row.deleted) {
                runOnUiThread(() -> {
                    Toast.makeText(this, "文章不存在", Toast.LENGTH_SHORT).show();
                    finish();
                });
                return;
            }
            Frontmatter.Parsed p = Frontmatter.parse(row.content);
            String title = Frontmatter.getTitle(p);
            if (title.isEmpty()) title = slug;
            String desc = Frontmatter.getDescription(p);
            String pub = Frontmatter.getPubDatetime(p);
            String date = (pub != null && pub.length() >= 10
                    && Character.isDigit(pub.charAt(0))) ? pub.substring(0, 10) : slug;
            int words = Frontmatter.countWords(p.body);
            String body = preprocess(p.body);

            // 图片下载需要登录 Cookie（站内图片过密码网关）；离线时为 null，走纯缓存
            if (SyncManager.isOnline(this)) {
                imageCookie = Auth.loginAndGetCookie();
            }

            final String fTitle = title, fDesc = desc, fDate = date, fBody = body;
            final int fWords = words;
            final boolean fDraft = Frontmatter.getDraft(p);
            runOnUiThread(() -> {
                topTitle.setText(fTitle);
                titleView.setText(fTitle);
                metaView.setText(fDate + " · 约 " + fWords + " 字"
                        + (fDraft ? " · 草稿" : ""));
                if (fDesc.isEmpty()) {
                    descView.setVisibility(android.view.View.GONE);
                } else {
                    descView.setVisibility(android.view.View.VISIBLE);
                    descView.setText(fDesc);
                }
                markwon.setMarkdown(bodyView, fBody);
            });
        }).start();
    }

    /** <video> 原生渲染不了，转成可点击的链接占位。 */
    private static String preprocess(String body) {
        if (body == null) return "";
        Matcher m = VIDEO_TAG.matcher(body);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            m.appendReplacement(sb, Matcher.quoteReplacement(
                    "\n\n🎬 [点击播放视频](" + m.group(1).trim() + ")\n\n"));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /**
     * 图片加载：磁盘缓存优先命中（离线可读）；
     * 未命中且在线时带 Cookie 下载并写入缓存。
     */
    private SchemeHandler cachedSchemeHandler() {
        return new SchemeHandler() {
            @Override
            public ImageItem handle(String raw, Uri uri) {
                String url = ImageCache.normalize(raw);
                if (url == null) return null;
                try {
                    File f = ImageCache.fetch(ReaderActivity.this, url, imageCookie);
                    if (f != null) {
                        return ImageItem.withDecodingNeeded(url, new FileInputStream(f));
                    }
                } catch (Exception ignored) {
                }
                return null;
            }

            @Override
            public Collection<String> supportedSchemes() {
                return Arrays.asList("http", "https");
            }
        };
    }
}
