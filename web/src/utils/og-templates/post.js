import { SITE } from "@/config";
import { formatDateZh } from "../date";
import letterOg from "./letter";

/** @param {import("astro:content").CollectionEntry<"blog">} post */
export default async post =>
  letterOg({
    eyebrow: formatDateZh(post.data.pubDatetime, post.data.timezone),
    title: post.data.title,
    subtitle: post.data.description,
    footer: `— ${post.data.author || SITE.author}`,
  });
