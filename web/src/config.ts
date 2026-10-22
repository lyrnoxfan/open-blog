/**
 * 站点配置：只放「内容与行为」相关的开关。
 * 视觉相关（颜色、字体、间距、圆角）统一在 src/styles/tokens.css。
 */
export const SITE = {
  website: "https://your-blog.example.com",
  author: "your-name",
  profile: "https://your-blog.example.com",
  title: "My Blog · 藤笺",
  desc: "藤花半架，闲笔数行。记技术，也记所思。",
  /** 印章上的字（页眉、签名、密码页共用的品牌记号） */
  seal: "爱",

  /** 站点默认分享图；留空则使用构建时生成的 /og.png */
  ogImage: "",
  /** 为每篇文章生成独立 OG 图（较慢，默认关闭） */
  dynamicOgImage: false,

  lightAndDarkMode: true,

  postPerIndex: 5,
  postPerPage: 5,

  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes

  showBackButton: true,

  editPost: {
    enabled: false,
    text: "在 GitHub 编辑",
    url: "https://github.com/your-username/your-repo/edit/main/",
  },

  dir: "ltr",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",
} as const;
