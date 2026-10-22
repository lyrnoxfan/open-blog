import type { CollectionEntry } from "astro:content";
import postFilter from "./postFilter";

const getSortedPosts = (posts: CollectionEntry<"blog">[]) => {
  return posts.filter(postFilter).sort(
    (a, b) =>
      Math.floor(new Date(b.data.pubDatetime).getTime() / 1000) -
        Math.floor(new Date(a.data.pubDatetime).getTime() / 1000) ||
      // 同一时间发布时按 id 排，保证顺序稳定
      b.id.localeCompare(a.id)
  );
};

export default getSortedPosts;
