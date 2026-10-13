export const SITE = {
  website: "https://your-blog.example.com", // 改成你的实际域名（没有也可以先用这个占位）
  author: "your-name",
  profile: "https://your-blog.example.com",
  desc: "一座用 Astro 搭建的个人博客。",
  title: "My Blog",

  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,

  postPerIndex: 5,
  postPerPage: 5,

  // 本站上线时间（用于首页底部“本站已运行”计时），按你的实际情况修改
  startDatetime: "2026-01-12T00:00:00+08:00",

  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes

  showBackButton: true, // show back button in post detail

  editPost: {
    enabled: false,
    text: "编辑页面",
    url: "https://github.com/satnaing/astro-paper/edit/main/",
  },

  dynamicOgImage: false,

  dir: "ltr", // "rtl" | "auto"
  lang: "zh-CN",

  timezone: "Asia/Shanghai",
} as const;
