/**
 * 归一化纯函数（REBUILD_PLAN 5.2.2）—— DOI / 标题 / 作者 / 年份 / venue / 摘要 / 语言。
 * 必须保持无副作用、可单测；融合层（fusion.ts）以此结果做候选 key 与字段择优。
 */

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** DOI 归一：去 https://doi.org/ 与 doi: 前缀、转小写、去尾部标点空白；`10.` 前缀校验，非法丢弃 */
export function normalizeDoi(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let s = String(raw).trim();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').replace(/^info:doi[/:]/i, '');
  s = s.toLowerCase().replace(/[.,;\s]+$/, '');
  if (!/^10\.\d{2,}\S*$/.test(s)) return undefined;
  return s;
}

/** HTML 实体解码（不引入依赖，覆盖常见实体） */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x?([0-9a-fA-F]+);/g, (_m, code) => {
      const n = code.startsWith('x') || code.startsWith('X') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    })
    .replace(/&nbsp;/g, ' ');
}

/** 标题指纹：NFKC → 去实体 → 去全部标点/空白 → 小写（5.2.2） */
export function titleFingerprint(raw: string): string {
  const s = decodeEntities(raw.normalize('NFKC'));
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

/** 去副标题指纹：按 `:`/`：`/`—`/`–` 首次出现切分取主标题（k3 候选 key 用） */
export function titleMainPart(raw: string): string {
  const decoded = decodeEntities(raw.normalize('NFKC'));
  const cut = decoded.search(/[:：—–]/);
  return (cut > 0 ? decoded.slice(0, cut) : decoded).trim();
}

/** 作者归一：去 *†‡ 标记；`Last, First` → `First Last`；NFC（展示用） */
export function normalizeAuthorName(raw: string): string {
  return decodeEntities(raw.normalize('NFC'))
    .replace(/[*†‡§¶]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(.+?),\s*(.+)$/, '$2 $1');
}

/** 作者比对键：小写、去标点 */
export function authorKey(raw: string): string {
  return normalizeAuthorName(raw).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

/** 姓氏提取（k3 用 Last, First → Last；中文取首字） */
export function authorSurname(raw: string): string {
  const n = normalizeAuthorName(raw);
  if (/[\u4e00-\u9fff]/.test(n)) return n.slice(0, 1);
  const parts = n.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** 年份解析：取 4 位数字，范围 1800..当前年+1，越界丢弃 */
export function parseYear(raw: unknown): number | undefined {
  const m = String(raw ?? '').match(/\d{4}/);
  if (!m) return undefined;
  const y = Number(m[0]);
  const max = new Date().getFullYear() + 1;
  return y >= 1800 && y <= max ? y : undefined;
}

/** venue 归一：去首尾空白、去完整 "Proceedings of (the)" 前缀（展示保留原样）；比对键转小写 */
export function normalizeVenue(raw: string): string {
  return raw.trim().replace(/^proceedings\s+of\s+(the\s+)?/i, '').replace(/\s+/g, ' ');
}

export function venueKey(raw: string): string {
  return normalizeVenue(raw).toLowerCase();
}

/** 摘要清洗：JATS/HTML 标签去除、实体解码、多余空白合并、≤3000 字（5.2.2） */
export function cleanAbstract(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = decodeEntities(
    String(raw)
      .replace(/<\/?(jats:[a-z-]+)[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > 3000 ? text.slice(0, 3000) + '…' : text;
}

/**
 * 语言判定（修复 A-05 的对称性）：中文 = 标题**或**摘要含 CJK；
 * 英文 = 标题与摘要均不含 CJK（仅凭标题判定英文是不对称缺陷的根源）。
 */
export function detectLang(title: string, abstract?: string): 'zh' | 'en' {
  if (CJK_RE.test(title) || (abstract ? CJK_RE.test(abstract) : false)) return 'zh';
  return 'en';
}

/** Dice 相似度（2-gram），k3 合并阈值 0.92 用（5.2.3） */
export function dice2(a: string, b: string): number {
  const grams = (s: string): string[] => {
    const src = s.replace(/\s+/g, '');
    if (src.length < 2) return src ? [src] : [];
    const out: string[] = [];
    for (let i = 0; i < src.length - 1; i++) out.push(src.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.length || !gb.length) return 0;
  const count = new Map<string, number>();
  for (const g of ga) count.set(g, (count.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of gb) {
    const c = count.get(g) ?? 0;
    if (c > 0) {
      hit++;
      count.set(g, c - 1);
    }
  }
  return (2 * hit) / (ga.length + gb.length);
}
