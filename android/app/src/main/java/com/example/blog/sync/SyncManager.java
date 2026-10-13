package com.example.blog.sync;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;

import com.example.blog.db.ArticleDb;
import com.example.blog.net.Api;
import com.example.blog.net.Auth;
import com.example.blog.util.ImageCache;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 离线写作同步引擎：
 * - 有网时自动：推送本地改动（增/改/删）→ 拉取服务端最新
 * - PUT 带 sha 乐观锁；409 冲突时本地优先，重取 sha 再推一次
 * - 单例防重入；通过 Callback 回主线程汇报结果
 */
public class SyncManager {

    public static class Result {
        public final boolean ok;
        public final String message;
        public final int pushed;
        public final int pulled;
        public final int failed;
        Result(boolean ok, String message, int pushed, int pulled, int failed) {
            this.ok = ok;
            this.message = message;
            this.pushed = pushed;
            this.pulled = pulled;
            this.failed = failed;
        }
    }

    public interface Callback {
        void onDone(Result result);
    }

    private static volatile boolean running = false;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    public static boolean isOnline(Context context) {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            if (n == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(n);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (Exception e) {
            return false;
        }
    }

    public static void syncNow(Context context, Callback callback) {
        if (running) {
            if (callback != null) {
                MAIN.post(() -> callback.onDone(
                        new Result(false, "同步进行中", 0, 0, 0)));
            }
            return;
        }
        running = true;
        Context appContext = context.getApplicationContext();
        new Thread(() -> {
            Result r = doSync(appContext);
            running = false;
            if (callback != null) MAIN.post(() -> callback.onDone(r));
        }).start();
    }

    private static Result doSync(Context context) {
        if (!isOnline(context)) {
            return new Result(false, "当前离线，改动已保存在本地", 0, 0, 0);
        }
        String cookie = Auth.loginAndGetCookie();
        if (cookie == null) {
            return new Result(false, "登录失败，稍后重试", 0, 0, 0);
        }
        ArticleDb db = new ArticleDb(context);
        int pushed = 0, pulled = 0, failed = 0;
        Set<String> pushedSlugs = new HashSet<>();
        try {
            // 1. 推送本地改动
            List<ArticleDb.Row> locals = db.getAll();
            for (ArticleDb.Row row : locals) {
                if (!row.dirty) continue;
                try {
                    if (row.deleted) {
                        try {
                            Api.deleteArticle(cookie, row.slug, row.sha);
                        } catch (Api.ApiException e) {
                            if (e.status != 404) throw e; // 404 = 服务端已无此文，视为成功
                        }
                        db.deleteRow(row.slug);
                    } else {
                        String newSha = putWithRetry(cookie, row.slug, row.sha, row.content);
                        db.markClean(row.slug, newSha, null);
                    }
                    pushed++;
                    pushedSlugs.add(row.slug);
                } catch (Exception e) {
                    failed++;
                }
            }

            // 2. 拉取服务端最新（推送后重取列表，避免误删刚上传的）
            //    正文 6 线程并行拉取；db 写操作加锁串行（SQLite 多连接并发写会锁库）
            Map<String, String> server = Api.getArticleList(cookie);
            ExecutorService pool = Executors.newFixedThreadPool(6);
            AtomicInteger pulledOk = new AtomicInteger();
            AtomicInteger pullFailed = new AtomicInteger();
            Set<String> pulledSlugs = ConcurrentHashMap.newKeySet();
            List<Future<?>> futures = new ArrayList<>();
            for (Map.Entry<String, String> e : server.entrySet()) {
                final String slug = e.getKey();
                final String serverSha = e.getValue();
                final ArticleDb.Row local;
                synchronized (db) { local = db.get(slug); }
                final boolean isNew = local == null;
                boolean needFetch = isNew
                        || (!local.dirty && !local.deleted && !serverSha.equals(local.sha));
                if (!needFetch) continue;
                futures.add(pool.submit(() -> {
                    try {
                        Api.ArticleContent ac = Api.getArticle(cookie, slug);
                        synchronized (db) {
                            if (isNew) db.insertClean(slug, ac.sha, ac.content);
                            else db.markClean(slug, ac.sha, ac.content);
                        }
                        pulledSlugs.add(slug);
                        pulledOk.incrementAndGet();
                    } catch (Exception ex) {
                        pullFailed.incrementAndGet();
                    }
                }));
            }
            for (Future<?> f : futures) {
                try { f.get(); } catch (Exception ignored) { pullFailed.incrementAndGet(); }
            }
            pool.shutdown();
            pulled += pulledOk.get();
            failed += pullFailed.get();

            // 3. 本地干净但服务端已删 → 跟随删除
            for (ArticleDb.Row row : db.getAll()) {
                if (!row.dirty && !row.deleted && !pushedSlugs.contains(row.slug)
                        && !server.containsKey(row.slug)) {
                    db.deleteRow(row.slug);
                }
            }

            // 4. 离线图片预缓存：只处理本次新拉取的文章，已缓存的跳过；4 线程并行下载
            try {
                Set<String> urls = new LinkedHashSet<>();
                synchronized (db) {
                    for (String slug : pulledSlugs) {
                        ArticleDb.Row row = db.get(slug);
                        if (row == null || row.deleted) continue;
                        urls.addAll(ImageCache.extractUrls(row.content));
                    }
                }
                ExecutorService imgPool = Executors.newFixedThreadPool(4);
                for (String url : urls) {
                    if (ImageCache.isCached(context, url)) continue;
                    final String u = url;
                    imgPool.submit(() -> ImageCache.fetch(context, u, cookie));
                }
                imgPool.shutdown();
                imgPool.awaitTermination(5, TimeUnit.MINUTES);
            } catch (Exception ignored) {
            }
        } catch (Exception e) {
            return new Result(false, "同步出错：" + e.getMessage(), pushed, pulled, failed + 1);
        }
        if (failed > 0) {
            return new Result(false, "部分同步失败（" + failed + "），下次重试", pushed, pulled, failed);
        }
        String msg = pushed == 0 && pulled == 0 ? "已是最新" : "同步完成";
        return new Result(true, msg, pushed, pulled, 0);
    }

    /** PUT 带 sha；409 冲突时本地优先，重取最新 sha 再推一次。 */
    private static String putWithRetry(String cookie, String slug, String sha, String content)
            throws Exception {
        try {
            return Api.putArticle(cookie, slug, sha, content);
        } catch (Api.ApiException e) {
            if (e.status != 409) throw e;
        }
        Api.ArticleContent latest = Api.getArticle(cookie, slug);
        return Api.putArticle(cookie, slug, latest.sha, content);
    }
}
