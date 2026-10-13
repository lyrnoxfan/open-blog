package com.example.blog;

import android.app.Application;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;

import com.example.blog.db.ArticleDb;
import com.example.blog.sync.SyncManager;

/** 应用启动时注册网络监听：断网重连后自动同步本地未上传的文章。 */
public class BlogApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkRequest req = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();
            cm.registerNetworkCallback(req, new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    // 重连后若有本地未同步的改动，自动上传
                    new Thread(() -> {
                        ArticleDb db = new ArticleDb(BlogApp.this);
                        try {
                            if (db.hasDirty()) SyncManager.syncNow(BlogApp.this, null);
                        } finally {
                            db.close();
                        }
                    }).start();
                }
            });
        } catch (Exception ignored) {
        }
    }
}
