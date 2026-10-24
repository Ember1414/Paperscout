/** 中英双语停用词（5.1.1：约 120 词，可维护；无区分度虚词） */
export const STOPWORDS = new Set<string>([
  // 英文
  'the', 'a', 'an', 'of', 'for', 'in', 'on', 'at', 'to', 'with', 'by', 'from', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'if', 'then',
  'than', 'that', 'this', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'you', 'your',
  'he', 'she', 'his', 'her', 'i', 'me', 'my', 'us', 'them', 'what', 'which', 'who', 'whom', 'whose',
  'how', 'why', 'when', 'where', 'can', 'could', 'may', 'might', 'will', 'would', 'shall', 'should',
  'do', 'does', 'did', 'done', 'has', 'have', 'had', 'using', 'use', 'used', 'via', 'based', 'towards',
  'toward', 'into', 'about', 'between', 'over', 'under', 'both', 'each', 'all', 'any', 'some', 'such',
  's', 't', 'd', 'll', 're', 've', 'm',
  // 中文
  '的', '了', '和', '是', '在', '与', '及', '或', '对', '于', '把', '被', '从', '到', '为',
  '以', '及', '并', '而', '其', '之', '中', '上', '下', '有', '无', '不', '等', '个', '我们',
  '他们', '这', '那', '什么', '怎么', '如何', '为什么', '可以', '能够', '一个', '一种', '该', '本',
]);
