package com.example.blog.db;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import com.example.blog.util.Frontmatter;

import java.util.ArrayList;
import java.util.List;

/** 本地文章库：离线阅读缓存 + 离线写作 + 同步队列。 */
public class ArticleDb extends SQLiteOpenHelper {

    private static final String DB = "blog.db";
    private static final int VERSION = 2;

    public static class Row {
        public String slug;
        public String content;
        public String sha;      // 服务端最新 sha（null = 从未上传过）
        public boolean dirty;   // 本地有改动待上传
        public boolean deleted; // 本地删除待同步（tombstone）
        public long updatedAt;
        // v2：展示用元数据（由 content 的 frontmatter 解析回填）
        public String title = "";
        public boolean draft = false;
        public String pubDatetime = "";
        public String description = "";
        public int wordCount = 0;
    }

    public ArticleDb(Context context) {
        super(context, DB, null, VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE articles (" +
                "slug TEXT PRIMARY KEY," +
                "content TEXT NOT NULL," +
                "sha TEXT," +
                "dirty INTEGER NOT NULL DEFAULT 0," +
                "deleted INTEGER NOT NULL DEFAULT 0," +
                "updated_at INTEGER NOT NULL," +
                "title TEXT NOT NULL DEFAULT ''," +
                "draft INTEGER NOT NULL DEFAULT 0," +
                "pub_datetime TEXT NOT NULL DEFAULT ''," +
                "description TEXT NOT NULL DEFAULT ''," +
                "word_count INTEGER NOT NULL DEFAULT 0)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE articles ADD COLUMN title TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE articles ADD COLUMN draft INTEGER NOT NULL DEFAULT 0");
            db.execSQL("ALTER TABLE articles ADD COLUMN pub_datetime TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE articles ADD COLUMN description TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE articles ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0");
            // 回填已有行的元数据
            try (Cursor c = db.rawQuery("SELECT slug,content FROM articles", null)) {
                while (c.moveToNext()) {
                    String slug = c.getString(0);
                    Meta m = metaOf(c.getString(1), slug);
                    ContentValues v = new ContentValues();
                    v.put("title", m.title);
                    v.put("draft", m.draft ? 1 : 0);
                    v.put("pub_datetime", m.pubDatetime);
                    v.put("description", m.description);
                    v.put("word_count", m.wordCount);
                    db.update("articles", v, "slug=?", new String[]{slug});
                }
            } catch (Exception ignored) {
            }
        }
    }

    /** 由正文解析展示元数据。 */
    public static class Meta {
        public String title = "";
        public boolean draft = false;
        public String pubDatetime = "";
        public String description = "";
        public int wordCount = 0;
    }

    public static Meta metaOf(String content, String fallbackTitle) {
        Meta m = new Meta();
        try {
            Frontmatter.Parsed p = Frontmatter.parse(content);
            m.title = Frontmatter.getTitle(p);
            if (m.title.isEmpty()) m.title = fallbackTitle;
            m.draft = Frontmatter.getDraft(p);
            m.pubDatetime = Frontmatter.getPubDatetime(p);
            m.description = Frontmatter.getDescription(p);
            m.wordCount = Frontmatter.countWords(p.body);
        } catch (Exception e) {
            m.title = fallbackTitle;
        }
        return m;
    }

    private static final String COLS =
            "slug,content,sha,dirty,deleted,updated_at,title,draft,pub_datetime,description,word_count";

    private static Row fromCursor(Cursor c) {
        Row r = new Row();
        r.slug = c.getString(0);
        r.content = c.getString(1);
        r.sha = c.isNull(2) ? null : c.getString(2);
        r.dirty = c.getInt(3) == 1;
        r.deleted = c.getInt(4) == 1;
        r.updatedAt = c.getLong(5);
        r.title = c.getString(6);
        r.draft = c.getInt(7) == 1;
        r.pubDatetime = c.getString(8);
        r.description = c.getString(9);
        r.wordCount = c.getInt(10);
        return r;
    }

    public List<Row> getAll() {
        List<Row> list = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT " + COLS + " FROM articles ORDER BY updated_at DESC", null)) {
            while (c.moveToNext()) list.add(fromCursor(c));
        }
        return list;
    }

    /** 首页列表：排除待删除，草稿置顶，再按发布时间倒序。 */
    public List<Row> getForHome() {
        List<Row> list = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT " + COLS + " FROM articles WHERE deleted=0 " +
                        "ORDER BY (draft OR dirty) DESC, pub_datetime DESC, updated_at DESC", null)) {
            while (c.moveToNext()) list.add(fromCursor(c));
        }
        return list;
    }

    public Row get(String slug) {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT " + COLS + " FROM articles WHERE slug=?", new String[]{slug})) {
            if (c.moveToFirst()) return fromCursor(c);
        }
        return null;
    }

    public boolean exists(String slug) {
        return get(slug) != null;
    }

    public boolean hasDirty() {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT 1 FROM articles WHERE dirty=1 LIMIT 1", null)) {
            return c.moveToFirst();
        } catch (Exception e) {
            return false;
        }
    }

    public int count() {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT COUNT(*) FROM articles WHERE deleted=0", null)) {
            if (c.moveToFirst()) return c.getInt(0);
        }
        return 0;
    }

    private static ContentValues withMeta(ContentValues v, String slug, String content) {
        Meta m = metaOf(content, slug);
        v.put("title", m.title);
        v.put("draft", m.draft ? 1 : 0);
        v.put("pub_datetime", m.pubDatetime);
        v.put("description", m.description);
        v.put("word_count", m.wordCount);
        return v;
    }

    /** 本地保存（新增或编辑），标记为待上传。 */
    public void saveLocal(String slug, String content) {
        ContentValues v = new ContentValues();
        v.put("slug", slug);
        v.put("content", content);
        v.put("dirty", 1);
        v.put("deleted", 0);
        v.put("updated_at", System.currentTimeMillis());
        withMeta(v, slug, content);
        getWritableDatabase().insertWithOnConflict("articles", null, v,
                SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** 本地删除：有 sha 的留 tombstone 等同步；从未上传的直接删行。 */
    public void markDeleted(String slug) {
        Row r = get(slug);
        if (r == null) return;
        if (r.sha == null) {
            getWritableDatabase().delete("articles", "slug=?", new String[]{slug});
        } else {
            ContentValues v = new ContentValues();
            v.put("dirty", 1);
            v.put("deleted", 1);
            v.put("updated_at", System.currentTimeMillis());
            getWritableDatabase().update("articles", v, "slug=?", new String[]{slug});
        }
    }

    public void markClean(String slug, String newSha, String content) {
        ContentValues v = new ContentValues();
        v.put("sha", newSha);
        if (content != null) {
            v.put("content", content);
            withMeta(v, slug, content);
        }
        v.put("dirty", 0);
        v.put("deleted", 0);
        v.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("articles", v, "slug=?", new String[]{slug});
    }

    public void insertClean(String slug, String sha, String content) {
        ContentValues v = new ContentValues();
        v.put("slug", slug);
        v.put("content", content);
        v.put("sha", sha);
        v.put("dirty", 0);
        v.put("deleted", 0);
        v.put("updated_at", System.currentTimeMillis());
        withMeta(v, slug, content);
        getWritableDatabase().insertWithOnConflict("articles", null, v,
                SQLiteDatabase.CONFLICT_REPLACE);
    }

    public void deleteRow(String slug) {
        getWritableDatabase().delete("articles", "slug=?", new String[]{slug});
    }
}
