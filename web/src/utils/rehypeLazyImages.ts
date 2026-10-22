// 文章图片懒加载：构建时给 Markdown 渲染出的 <img> 补 loading="lazy" decoding="async"。
// 只改输出 HTML，不改文章原文；已写了 loading 的图片保持原样，首图除外以免拖慢首屏。
// 站内 /public 图片顺便补上 width/height（读真实尺寸），避免图片加载后整页下跳（CLS）。
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

type Node = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const PUBLIC_DIR = path.resolve("public");
const sizeCache = new Map<string, { width: number; height: number } | null>();

async function localSize(src: string) {
  if (!src.startsWith("/") || src.startsWith("//")) return null;
  const file = path.join(PUBLIC_DIR, decodeURIComponent(src.split(/[?#]/)[0]));
  if (!file.startsWith(PUBLIC_DIR)) return null;
  if (sizeCache.has(file)) return sizeCache.get(file)!;
  let size: { width: number; height: number } | null = null;
  try {
    if (existsSync(file)) {
      const { width, height, orientation } = await sharp(file).metadata();
      if (width && height) {
        size =
          orientation && orientation >= 5
            ? { width: height, height: width }
            : { width, height };
      }
    }
  } catch {
    /* 读不到尺寸就不补，保持原样 */
  }
  sizeCache.set(file, size);
  return size;
}

export default function rehypeLazyImages() {
  return async (tree: Node) => {
    const imgs: Node[] = [];
    const walk = (node: Node) => {
      if (node.type === "element" && node.tagName === "img") imgs.push(node);
      node.children?.forEach(walk);
    };
    walk(tree);
    await Promise.all(
      imgs.map(async (node, i) => {
        const props = (node.properties ??= {});
        if (i > 0 && props.loading == null) props.loading = "lazy";
        if (props.decoding == null) props.decoding = "async";
        if (
          props.width == null &&
          props.height == null &&
          typeof props.src === "string"
        ) {
          const size = await localSize(props.src);
          if (size) {
            props.width = size.width;
            props.height = size.height;
          }
        }
      })
    );
  };
}
