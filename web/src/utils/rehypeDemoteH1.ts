// 正文里的「# 标题」降为 h2：页面只保留文章标题这一个 h1，目次（只收 h2/h3）也能收到这些小节。
// 只改输出 HTML，不改文章原文。
type Node = { type: string; tagName?: string; children?: Node[] };

export default function rehypeDemoteH1() {
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (node.type === "element" && node.tagName === "h1") node.tagName = "h2";
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
