package com.example.blog.util;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

/**
 * 全面屏适配：Android 15+ 对 targetSdk 35+ 强制 edge-to-edge，
 * 不处理的话顶栏会被状态栏盖住、底部 Dock 会被导航栏盖住。
 * 这里给内容根视图加上系统栏内边距，三个 Activity 通用。
 */
public class EdgeToEdge {

    public static void apply(Activity activity) {
        try {
            applyInternal(activity);
        } catch (Exception ignored) {
            // 全面屏适配绝不能导致启动崩溃
        }
    }

    private static void applyInternal(Activity activity) {
        // 浅色背景用深色状态栏图标
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            View decor = activity.getWindow().getDecorView();
            decor.setSystemUiVisibility(
                    decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
        View root = activity.findViewById(android.R.id.content);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets s =
                        insets.getInsets(WindowInsets.Type.statusBars());
                android.graphics.Insets n =
                        insets.getInsets(WindowInsets.Type.navigationBars());
                top = s.top;
                bottom = n.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            if (v.getPaddingTop() != top || v.getPaddingBottom() != bottom) {
                v.setPadding(v.getPaddingLeft(), top, v.getPaddingRight(), bottom);
            }
            return insets;
        });
    }
}
