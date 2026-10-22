// 与写作台预览一致：段落里的单个换行渲染为换行（<br>），不必空一行。
// 只影响构建输出，不改文章原文。代码块、行内代码不受影响（它们不是 text 节点）。
// 硬换行排版的转载长文（从 PDF 复制、每行固定字数）排除在外，保持原来的合并成段。
type Node = { type: string; value?: string; children?: Node[] };

const EXCLUDE: string[] = [];

export default function remarkSoftBreaks() {
  return (tree: Node, file: { path?: string; history?: string[] }) => {
    // Windows 下 path 用反斜杠，统一成正斜杠后再匹配文件名
    const path = (file.path || file.history?.[0] || "")
      .normalize("NFC")
      .replace(/\\/g, "/");
    if (EXCLUDE.some(name => path.endsWith(`/${name}`))) return;
    const walk = (node: Node) => {
      if (!node.children) return;
      const out: Node[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value?.includes("\n")) {
          const parts = child.value.split(/\r?\n/);
          parts.forEach((part, i) => {
            if (i > 0) out.push({ type: "break" });
            if (part) out.push({ type: "text", value: part });
          });
        } else {
          walk(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    walk(tree);
  };
}
