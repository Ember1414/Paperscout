/**
 * PaperScout 预热 Worker（Cron Trigger）
 * 每 30 分钟执行一次：
 * 1. 强制刷新「最新论文雷达」爬虫缓存，用户访问永远秒开
 * 2. 对热词统计中的 Top 关键词预取检索结果，命中 KV 缓存
 */

const BASE = 'https://paperscout.pages.dev';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(warm());
  },
};

async function warm() {
  // 1. 刷新论文雷达
  try {
    await fetch(`${BASE}/api/trending?refresh=1`, {
      headers: { 'User-Agent': 'PaperScout-Warmer/1.0' },
    });
    console.log('trending warmed');
  } catch (e) {
    console.error('trending warm failed:', e.message);
  }

  // 2. 预热热词的检索结果
  try {
    const res = await fetch(`${BASE}/api/stats`);
    const data = await res.json();
    const keywords = (data.top ?? []).slice(0, 5).map((k) => k.keyword);
    for (const kw of keywords) {
      await fetch(`${BASE}/api/search?q=${encodeURIComponent(kw)}&limit=20&sort=smart`, {
        headers: { 'User-Agent': 'PaperScout-Warmer/1.0' },
      }).catch(() => {});
    }
    console.log('keywords warmed:', keywords.length);
  } catch (e) {
    console.error('keyword warm failed:', e.message);
  }
}
