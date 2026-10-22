import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import { SITE } from "@/config";
import guestHidden from "./data/guest-hidden.json";

export const BLOG_PATH = "src/data/blog";

// 访客分站构建（GUEST_BUILD=1）时，写作台标记「对访客隐藏」的文章直接不进集合，
// 列表、标签、归档、随机、RSS、OG 图、搜索索引都不会出现它们。总站构建不受影响。
const GUEST_EXCLUDES =
  process.env.GUEST_BUILD === "1"
    ? (guestHidden.hidden ?? []).map(slug => `!${slug}.md`)
    : [];

const blog = defineCollection({
  loader: glob({
    pattern: ["**/[^_]*.md", ...GUEST_EXCLUDES],
    base: `./${BLOG_PATH}`,
  }),
  schema: ({ image }) =>
    z.object({
      author: z.string().default(SITE.author),
      pubDatetime: z.date(),
      modDatetime: z.date().optional().nullable(),
      title: z.string(),
      draft: z.boolean().optional(),
      pinned: z.boolean().default(false),
      tags: z.array(z.string()).default(["others"]),
      ogImage: image().or(z.string()).optional(),
      description: z.string(),
      canonicalURL: z.string().optional(),
      hideEditPost: z.boolean().optional(),
      timezone: z.string().optional(),
    }),
});

export const collections = { blog };
