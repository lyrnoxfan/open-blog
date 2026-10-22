package com.example.blog;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.example.blog.db.ArticleDb;
import com.example.blog.net.Api;
import com.example.blog.net.Auth;
import com.example.blog.sync.SyncManager;
import com.example.blog.util.EdgeToEdge;
import com.example.blog.util.Frontmatter;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** 原生 Markdown 编辑器：离线保存到本地，有网自动上传；支持图片/视频上传。 */
public class EditorActivity extends Activity {

    private static final int PICK_IMAGE = 2001;
    private static final int PICK_VIDEO = 2002;
    private static final long IMAGE_MAX = 8L * 1024 * 1024;
    private static final long VIDEO_MAX = 25L * 1024 * 1024;

    private ArticleDb db;
    private String slug;          // null = 新文章
    private Frontmatter.Parsed original;
    private boolean wasDraft;
    private boolean uploading = false;

    private EditText slugInput;
    private EditText titleInput;
    private EditText descInput;
    private EditText tagsInput;
    private CheckBox draftCheck;
    private CheckBox pinnedCheck;
    private EditText bodyInput;
    private TextView wordCount;
    private TextView editorTitle;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_editor);
        EdgeToEdge.apply(this);
        db = new ArticleDb(this);

        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_save).setOnClickListener(v -> save());
        editorTitle = findViewById(R.id.editor_title);

        slugInput = findViewById(R.id.input_slug);
        titleInput = findViewById(R.id.input_title);
        descInput = findViewById(R.id.input_desc);
        tagsInput = findViewById(R.id.input_tags);
        draftCheck = findViewById(R.id.check_draft);
        pinnedCheck = findViewById(R.id.check_pinned);
        bodyInput = findViewById(R.id.input_body);
        wordCount = findViewById(R.id.word_count);

        // Markdown 工具栏
        findViewById(R.id.md_bold).setOnClickListener(v -> wrapSelection("**", "**"));
        findViewById(R.id.md_heading).setOnClickListener(v -> prefixLines("## "));
        findViewById(R.id.md_quote).setOnClickListener(v -> prefixLines("> "));
        findViewById(R.id.md_list).setOnClickListener(v -> prefixLines("- "));
        findViewById(R.id.md_code).setOnClickListener(v -> wrapSelection("`", "`"));
        findViewById(R.id.md_link).setOnClickListener(v -> insertAtCursor("[链接文字](https://)"));
        findViewById(R.id.md_image).setOnClickListener(v -> pickMedia("image/*", PICK_IMAGE));
        findViewById(R.id.md_video).setOnClickListener(v -> pickMedia("video/*", PICK_VIDEO));

        slug = getIntent().getStringExtra("slug");
        if (slug != null) {
            editorTitle.setText("编辑文章");
            ArticleDb.Row row = db.get(slug);
            if (row == null) {
                Toast.makeText(this, "文章不存在", Toast.LENGTH_SHORT).show();
                finish();
                return;
            }
            original = Frontmatter.parse(row.content);
            wasDraft = Frontmatter.getDraft(original);
            slugInput.setText(slug);
            slugInput.setEnabled(false);
            titleInput.setText(Frontmatter.getTitle(original));
            descInput.setText(Frontmatter.getDescription(original));
            tagsInput.setText(String.join(", ", Frontmatter.getTags(original)));
            draftCheck.setChecked(wasDraft);
            pinnedCheck.setChecked(Frontmatter.getPinned(original));
            bodyInput.setText(original.body);
        } else {
            editorTitle.setText("新文章 ♡");
            original = Frontmatter.parse("");
            wasDraft = true;
            draftCheck.setChecked(true);
            slugInput.setHint("留空自动生成");
        }

        updateCount();
        bodyInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                if (!uploading) updateCount();
            }
        });
    }

    // ---------- Markdown 快捷操作 ----------

    private void insertAtCursor(String text) {
        int s = Math.max(bodyInput.getSelectionStart(), 0);
        int e = Math.max(bodyInput.getSelectionEnd(), 0);
        bodyInput.getText().replace(Math.min(s, e), Math.max(s, e), text);
    }

    private void wrapSelection(String pre, String suf) {
        int s = bodyInput.getSelectionStart();
        int e = bodyInput.getSelectionEnd();
        if (s < 0 || e < 0) {
            insertAtCursor(pre + suf);
            bodyInput.setSelection(bodyInput.getSelectionStart() - suf.length());
            return;
        }
        int a = Math.min(s, e), b = Math.max(s, e);
        String sel = bodyInput.getText().subSequence(a, b).toString();
        bodyInput.getText().replace(a, b, pre + sel + suf);
    }

    /** 给选中行（或当前行）加前缀；已有的再点一次就去掉（toggle）。 */
    private void prefixLines(String prefix) {
        Editable t = bodyInput.getText();
        int s = bodyInput.getSelectionStart();
        int e = bodyInput.getSelectionEnd();
        if (s < 0 || e < 0) s = e = t.length();
        int a = Math.min(s, e), b = Math.max(s, e);
        int ls = a;
        while (ls > 0 && t.charAt(ls - 1) != '\n') ls--;
        int le = b;
        while (le < t.length() && t.charAt(le) != '\n') le++;
        String[] lines = t.subSequence(ls, le).toString().split("\n", -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) sb.append('\n');
            if (lines[i].startsWith(prefix)) sb.append(lines[i].substring(prefix.length()));
            else sb.append(prefix).append(lines[i]);
        }
        t.replace(ls, le, sb.toString());
    }

    // ---------- 图片 / 视频上传 ----------

    private void pickMedia(String type, int requestCode) {
        if (uploading) {
            Toast.makeText(this, "正在上传，请稍候…", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType(type);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(Intent.createChooser(intent, "选择文件"), requestCode);
        } catch (Exception ex) {
            Toast.makeText(this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if ((requestCode == PICK_IMAGE || requestCode == PICK_VIDEO)
                && resultCode == RESULT_OK && data != null && data.getData() != null) {
            uploadAndInsert(data.getData(), requestCode == PICK_VIDEO);
        }
    }

    private void uploadAndInsert(Uri uri, boolean isVideo) {
        uploading = true;
        setMediaButtonsEnabled(false);
        wordCount.setText("准备上传…");
        new Thread(() -> {
            try {
                ContentResolver cr = getContentResolver();
                String mime = cr.getType(uri);
                if (mime == null) mime = isVideo ? "video/mp4" : "image/jpeg";
                long max = isVideo ? VIDEO_MAX : IMAGE_MAX;
                byte[] bytes = readBytes(uri, max);
                String name = displayName(uri);
                if (name == null || name.isEmpty()) {
                    name = (isVideo ? "video-" : "image-") + System.currentTimeMillis() / 1000;
                }
                String cookie = Auth.loginAndGetCookie();
                if (cookie == null) throw new IOException("登录失败，请检查网络");
                String url = Api.uploadMedia(cookie, name, mime, bytes,
                        pct -> runOnUiThread(() -> wordCount.setText("上传中… " + pct + "%")));
                String full = Auth.SITE + url;
                String stem = name.replaceAll("\\.[^.]+$", "");
                String md = isVideo
                        ? "\n<video controls playsinline preload=\"metadata\" src=\"" + full
                          + "\" style=\"max-width:100%;border-radius:12px\"></video>\n"
                        : "\n![" + stem + "](" + full + ")\n";
                runOnUiThread(() -> {
                    insertAtCursor(md);
                    Toast.makeText(this, "上传成功 ♡", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception ex) {
                runOnUiThread(() ->
                        Toast.makeText(this, "上传失败：" + ex.getMessage(), Toast.LENGTH_LONG).show());
            } finally {
                uploading = false;
                runOnUiThread(() -> {
                    setMediaButtonsEnabled(true);
                    updateCount();
                });
            }
        }).start();
    }

    private void setMediaButtonsEnabled(boolean enabled) {
        findViewById(R.id.md_image).setEnabled(enabled);
        findViewById(R.id.md_video).setEnabled(enabled);
        ((Button) findViewById(R.id.md_image)).setText(enabled ? "🖼" : "…");
        ((Button) findViewById(R.id.md_video)).setText(enabled ? "🎬" : "…");
    }

    private byte[] readBytes(Uri uri, long maxBytes) throws IOException {
        try (InputStream in = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IOException("无法读取文件");
            byte[] buf = new byte[32768];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > maxBytes) {
                    throw new IOException("文件超过 " + (maxBytes / 1024 / 1024) + "MB 限制");
                }
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return c.getString(idx);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    // ---------- 保存 ----------

    private void updateCount() {
        wordCount.setText("约 " + Frontmatter.countWords(bodyInput.getText().toString()) + " 字");
    }

    /** 标签输入：逗号/中文逗号/空格分隔，去重保序（与网页写作台一致）。 */
    private static List<String> parseTags(String raw) {
        List<String> out = new ArrayList<>();
        if (raw == null) return out;
        for (String part : raw.split("[,，\\s]+")) {
            String t = part.trim();
            if (!t.isEmpty() && !out.contains(t)) out.add(t);
        }
        return out;
    }

    private void save() {
        String title = titleInput.getText().toString().trim();
        if (title.isEmpty()) {
            Toast.makeText(this, "标题不能为空", Toast.LENGTH_SHORT).show();
            return;
        }
        String finalSlug = slug;
        if (finalSlug == null) {
            String input = slugInput.getText().toString().trim();
            finalSlug = input.isEmpty() ? Frontmatter.slugify(title) : input;
            if (!finalSlug.matches("[\\p{L}\\p{N}._-]+")) {
                Toast.makeText(this, "slug 只能含字母、数字、中文、._-", Toast.LENGTH_SHORT).show();
                return;
            }
            String base = finalSlug;
            int n = 2;
            while (db.exists(finalSlug)) {
                finalSlug = base + "-" + (n++);
            }
        }
        String content = Frontmatter.build(
                original,
                title,
                descInput.getText().toString().trim(),
                parseTags(tagsInput.getText().toString()),
                pinnedCheck.isChecked(),
                draftCheck.isChecked(),
                bodyInput.getText().toString(),
                slug == null,
                wasDraft);
        db.saveLocal(finalSlug, content);
        Toast.makeText(this, "已保存到本地" +
                (SyncManager.isOnline(this) ? "，正在上传…" : "（离线，联网后自动上传）"),
                Toast.LENGTH_SHORT).show();
        SyncManager.syncNow(this, null);
        finish();
    }

    @Override
    protected void onDestroy() {
        db.close();
        super.onDestroy();
    }
}
