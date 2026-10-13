import type { CollectionEntry } from "astro:content";
import { slugifyStr } from "./slugify";
import postFilter from "./postFilter";

export interface TagInfo {
  tag: string;
  tagName: string;
  count: number;
}

const getUniqueTags = (posts: CollectionEntry<"blog">[]): TagInfo[] => {
  const filteredPosts = posts.filter(postFilter);
  const tagMap = new Map<string, { tagName: string; count: number }>();

  for (const post of filteredPosts) {
    for (const tagName of post.data.tags ?? []) {
      const tag = slugifyStr(tagName);
      const entry = tagMap.get(tag);
      if (entry) {
        entry.count += 1;
      } else {
        tagMap.set(tag, { tagName, count: 1 });
      }
    }
  }

  return [...tagMap.entries()]
    .map(([tag, { tagName, count }]) => ({ tag, tagName, count }))
    .sort(
      (a, b) =>
        b.count - a.count || a.tagName.localeCompare(b.tagName, "zh-CN")
    );
};

export default getUniqueTags;
