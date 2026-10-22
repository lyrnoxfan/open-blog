package com.example.blog;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import com.example.blog.db.ArticleDb;
import com.example.blog.sync.SyncManager;
import com.example.blog.util.EdgeToEdge;

import java.util.ArrayList;
import java.util.List;

/**
 * 原生首页：文章列表，全部走本地数据库，离线可用。
 * 有网时点 ↻ 同步（拉全量文章+图片预缓存，推本地改动）。
 */
public class HomeActivity extends Activity {

    private ArticleDb db;
    private TextView syncStatus;
    private ArticleAdapter adapter;
    private List<ArticleDb.Row> rows = new ArrayList<>();
    private boolean syncing = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_home);
        EdgeToEdge.apply(this);
        db = new ArticleDb(this);

        syncStatus = findViewById(R.id.sync_status);
        ListView listView = findViewById(R.id.list);
        adapter = new ArticleAdapter();
        listView.setAdapter(adapter);
        listView.setEmptyView(findViewById(R.id.empty));

        findViewById(R.id.btn_sync).setOnClickListener(v -> doSync());
        findViewById(R.id.btn_new).setOnClickListener(v ->
                startActivity(new Intent(this, EditorActivity.class)));

        listView.setOnItemClickListener((parent, view, position, id) -> {
            Intent i = new Intent(this, ReaderActivity.class);
            i.putExtra("slug", rows.get(position).slug);
            startActivity(i);
        });
        listView.setOnItemLongClickListener((parent, view, position, id) -> {
            ArticleDb.Row row = rows.get(position);
            new AlertDialog.Builder(this)
                    .setTitle(row.title.isEmpty() ? row.slug : row.title)
                    .setItems(new String[]{"编辑", "删除"}, (d, which) -> {
                        if (which == 0) {
                            Intent i = new Intent(this, EditorActivity.class);
                            i.putExtra("slug", row.slug);
                            startActivity(i);
                        } else {
                            new AlertDialog.Builder(this)
                                    .setTitle("删除文章")
                                    .setMessage("删除「" + displayTitle(row) + "」？\n有网时会自动同步到服务器。")
                                    .setPositiveButton("删除", (d2, w) -> {
                                        db.markDeleted(row.slug);
                                        refresh();
                                        doSync();
                                    })
                                    .setNegativeButton("取消", null)
                                    .show();
                        }
                    })
                    .show();
            return true;
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        // 首次使用（本地无文章）或有未上传改动时，有网就自动同步一次
        if (!syncing && (rows.isEmpty() || db.hasDirty()) && SyncManager.isOnline(this)) {
            doSync();
        }
    }

    @Override
    protected void onDestroy() {
        db.close();
        super.onDestroy();
    }

    private static String displayTitle(ArticleDb.Row r) {
        return r.title.isEmpty() ? r.slug : r.title;
    }

    /** pubDatetime 是 ISO 字符串，取日期部分；取不到就用 slug。 */
    private static String shortDate(ArticleDb.Row r) {
        if (r.pubDatetime != null && r.pubDatetime.length() >= 10
                && Character.isDigit(r.pubDatetime.charAt(0))) {
            return r.pubDatetime.substring(0, 10);
        }
        return r.slug.length() > 10 ? r.slug.substring(0, 10) : r.slug;
    }

    private void refresh() {
        rows = db.getForHome();
        adapter.notifyDataSetChanged();
        updateStatus(null);
    }

    private void updateStatus(String override) {
        if (override != null) {
            syncStatus.setText(override);
            return;
        }
        long dirty = 0;
        for (ArticleDb.Row r : rows) if (r.dirty) dirty++;
        if (dirty > 0) {
            syncStatus.setText("● " + dirty + " 篇待上传");
            syncStatus.setTextColor(0xFFF59E0B);
        } else if (!SyncManager.isOnline(this)) {
            syncStatus.setText("离线模式 · 共 " + rows.size() + " 篇");
            syncStatus.setTextColor(0xFF8A97B0);
        } else {
            syncStatus.setText("✓ 已同步 · 共 " + rows.size() + " 篇");
            syncStatus.setTextColor(0xFF16A34A);
        }
    }

    private void doSync() {
        if (syncing) return;
        if (!SyncManager.isOnline(this)) {
            Toast.makeText(this, "当前离线，显示本地缓存", Toast.LENGTH_SHORT).show();
            updateStatus(null);
            return;
        }
        syncing = true;
        syncStatus.setText("⟳ 同步中…");
        syncStatus.setTextColor(0xFF5B8DEF);
        SyncManager.syncNow(this, result -> {
            syncing = false;
            refresh();
            Toast.makeText(this, result.message, Toast.LENGTH_SHORT).show();
        });
    }

    private class ArticleAdapter extends BaseAdapter {
        @Override public int getCount() { return rows.size(); }
        @Override public Object getItem(int p) { return rows.get(p); }
        @Override public long getItemId(int p) { return p; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            if (convertView == null) {
                convertView = LayoutInflater.from(HomeActivity.this)
                        .inflate(R.layout.item_home_article, parent, false);
            }
            ArticleDb.Row r = rows.get(position);
            TextView title = convertView.findViewById(R.id.item_title);
            TextView badge = convertView.findViewById(R.id.item_badge);
            TextView meta = convertView.findViewById(R.id.item_meta);
            TextView desc = convertView.findViewById(R.id.item_desc);

            title.setText(displayTitle(r));
            if (r.dirty) {
                badge.setVisibility(View.VISIBLE);
                badge.setText("待上传");
                badge.setTextColor(0xFFF59E0B);
            } else if (r.draft) {
                badge.setVisibility(View.VISIBLE);
                badge.setText("草稿");
                badge.setTextColor(0xFFF472B6);
            } else {
                badge.setVisibility(View.GONE);
            }
            meta.setText(shortDate(r) + " · 约 " + r.wordCount + " 字");
            if (r.description.isEmpty()) {
                desc.setVisibility(View.GONE);
            } else {
                desc.setVisibility(View.VISIBLE);
                desc.setText(r.description);
            }
            return convertView;
        }
    }
}
