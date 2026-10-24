/**
 * AI Prompt 契约（REBUILD_PLAN 5.9.2 / 附录 C）。
 * PROMPT_VERSION 任何提示词改动必须 +1；缓存 key 必含此版本（附录 C）。
 */

export const PROMPT_VERSION = 'v1';

/** 零幻觉系统提示（summarize / ask 共用骨架） */
export const SYSTEM_PROMPT = `你是学术文献分析助手。只能使用 <evidence> 中提供的内容作答。
规则：
1. 每个事实性论断后必须标注 [编号]，编号必须来自 <evidence>。
2. 不允许推断作者意图、不允许补充 evidence 之外的背景知识。
3. 若 evidence 不足以回答，只输出：INSUFFICIENT_EVIDENCE
4. 不确定时明确写"文献未说明"。
5. 输出简体中文，不使用感叹号，不堆形容词。`;

/** 单篇精读提示（M6-07） */
export const EXTRACT_PROMPT = `你是学术文献分析助手。只能使用 <paper> 中提供的内容。
请从以下四个维度分析这篇论文，每个维度 1-2 句话，每个论断标注 [1]（唯一来源编号）：
1. 贡献：这篇论文的主要贡献是什么？
2. 方法：使用了什么方法？
3. 证据强度：证据是否充分？有无局限性？
4. 局限：主要局限性是什么？
若论文中未说明某维度，写"文献未说明"。`;

/** 自然语言 → 检索式 DSL 提示（M6-08） */
export const DSL_PROMPT = `你是学术检索助手。将用户的自然语言描述转换为检索式。
规则：
1. 只输出检索式本身，不要解释。
2. 支持语法：author:名 year:YYYY venue:名 type:期刊/会议/预印本 "短语" -排除词。
3. 不确定时输出原始关键词。

用户输入：`;

/**
 * 组装 evidence 块（每条摘要截断 600 字，总预算 ≤6000 字）
 * @param {{ title: string, abstract?: string }[]} papers
 * @returns {string}
 */
export function buildEvidence(papers: { title: string; abstract?: string }[]): string {
  const parts = [];
  let total = 0;
  for (let i = 0; i < papers.length; i++) {
    const abs = String(papers[i].abstract ?? '').slice(0, 600);
    const chunk = `[${i + 1}] ${papers[i].title}\n${abs}`;
    if (total + chunk.length > 6000) break;
    total += chunk.length;
    parts.push(chunk);
  }
  return `<evidence>\n${parts.join('\n\n')}\n</evidence>`;
}
