/**
 * 统计文本字数：
 * - 中日韩表意字符：每个计 1 字
 * - 其余按英文单词切分：每个单词计 1 字
 */
export function countWords(text: string): number {
  if (!text) return 0;

  const cjkMatches = text.match(
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g
  );
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  const withoutCjk = text.replace(
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g,
    " "
  );
  const wordCount = withoutCjk
    .split(/[^A-Za-z0-9']+/)
    .filter(word => word.length > 0).length;

  return cjkCount + wordCount;
}
