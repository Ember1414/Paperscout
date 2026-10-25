/** 中英双语停用词（5.1.1 约 120 词 → M10-05 扩至约 200 词；无区分度虚词） */
export const STOPWORDS = new Set<string>([
  // 英文：冠词/代词/助动词/介词/连词
  'the', 'a', 'an', 'of', 'for', 'in', 'on', 'at', 'to', 'with', 'by', 'from', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'if', 'then',
  'than', 'that', 'this', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'you', 'your',
  'he', 'she', 'his', 'her', 'i', 'me', 'my', 'us', 'them', 'what', 'which', 'who', 'whom', 'whose',
  'how', 'why', 'when', 'where', 'can', 'could', 'may', 'might', 'will', 'would', 'shall', 'should',
  'do', 'does', 'did', 'done', 'has', 'have', 'had', 'there', 'here',
  // 英文：常见论文虚词（M10-05 新增）
  'using', 'use', 'used', 'via', 'based', 'towards', 'toward', 'into', 'about', 'between', 'over',
  'under', 'both', 'each', 'all', 'any', 'some', 'such', 'other', 'another', 'more', 'most', 'less',
  'least', 'much', 'many', 'few', 'very', 'quite', 'rather', 'also', 'too', 'just', 'only', 'even',
  'still', 'yet', 'now', 'new', 'old', 'same', 'different', 'similar',
  'study', 'studies', 'paper', 'papers', 'article', 'articles', 'work', 'works', 'research',
  'approach', 'approaches', 'method', 'methods', 'technique', 'techniques', 'result', 'results',
  'conclusion', 'conclusions', 'introduction', 'background', 'related', 'proposed', 'propose',
  'present', 'presented', 'show', 'shown', 'shows', 'demonstrate', 'demonstrated',
  'performance', 'effect', 'effects', 'impact', 'role', 'factor', 'factors',
  'however', 'therefore', 'moreover', 'furthermore', 'nevertheless', 'nonetheless',
  'although', 'though', 'because', 'since', 'while', 'whereas', 'thus', 'hence', 'so',
  'first', 'second', 'third', 'finally', 'last', 'next',
  's', 't', 'd', 'll', 're', 've', 'm', 'x', 'y', 'n',
  // 中文
  '的', '了', '和', '是', '在', '与', '及', '或', '对', '于', '把', '被', '从', '到', '为',
  '以', '并', '而', '其', '之', '中', '上', '下', '有', '无', '不', '等', '个', '我们',
  '他们', '这', '那', '什么', '怎么', '如何', '为什么', '可以', '能够', '一个', '一种', '该', '本',
  // 中文：常见论文虚词（M10-05 新增）
  '研究', '方法', '分析', '结果', '结论', '问题', '影响', '作用', '因素', '效果',
  '提出', '基于', '通过', '利用', '针对', '主要', '重要', '关键', '相关',
  '不同', '相同', '类似', '其他', '另外', '同时', '此外', '因此', '所以',
  '以及', '还有', '就是', '即为', '也就是说', '例如', '比如',
]);
