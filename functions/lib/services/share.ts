import { AppError } from '../errors';

/**
 * 分享快照（REBUILD_PLAN 5.14 / M7-06）：/api/share POST 创建 + GET ?code= 读取。
 * D1 shares 表（M1-10 已建）；6 位 base62 短码；7/30/永久 TTL。
 */

function base62(n: number): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** POST /api/share { title, kind, items[] } → { code, ownerToken } */
export async function createShare(request: Request, env: { DB?: D1Database }): Promise<any> {
  const db = env?.DB;
  if (!db) throw new AppError('INTERNAL', 'D1 不可用');
  const body: any = await request.json().catch(() => ({}));
  const title = String(body.title ?? 'PaperScout 分享').slice(0, 120);
  const kind = ['results', 'evidence'].includes(body.kind) ? body.kind : 'results';
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!items.length) throw new AppError('BAD_PARAM', '至少 1 条记录');
  const payload = JSON.stringify(items).slice(0, 60_000);
  const code = base62(6);
  const ownerToken = crypto.randomUUID();
  const ttl = body.ttl === 7 || body.ttl === 30 ? body.ttl : 30;
  const expiresAt = Date.now() + ttl * 86_400_000;

  await db.prepare(
    'INSERT INTO shares (code, kind, payload, title, owner_token, created_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7)'
  ).bind(code, kind, payload, title, ownerToken, Date.now(), expiresAt).run();

  return { code, ownerToken, expiresAt };
}

/** GET /api/share?code= → 快照数据 */
export async function getShare(url: URL, env: { DB?: D1Database }): Promise<any> {
  const db = env?.DB;
  if (!db) throw new AppError('INTERNAL', 'D1 不可用');
  const code = url.searchParams.get('code') ?? '';
  if (!/^[A-Za-z0-9]{6}$/.test(code)) throw new AppError('BAD_PARAM', '分享码格式不合法');
  const row: any = await db.prepare('SELECT payload, title, kind, expires_at FROM shares WHERE code = ?1').bind(code).first();
  if (!row) throw new AppError('NOT_FOUND', '分享不存在或已过期');
  if (row.expires_at && row.expires_at < Date.now()) throw new AppError('NOT_FOUND', '分享已过期');
  return { code, kind: row.kind, title: row.title, items: JSON.parse(row.payload ?? '[]'), expiresAt: row.expires_at };
}

/** DELETE /api/share?code= （凭 ownerToken） */
export async function deleteShare(url: URL, request: Request, env: { DB?: D1Database }): Promise<any> {
  const db = env?.DB;
  if (!db) throw new AppError('INTERNAL', 'D1 不可用');
  const code = url.searchParams.get('code') ?? '';
  const token = request.headers.get('X-Owner-Token') ?? '';
  if (!code || !token) throw new AppError('BAD_PARAM', '缺少 code 或 ownerToken');
  const row: any = await db.prepare('SELECT owner_token FROM shares WHERE code = ?1').bind(code).first();
  if (!row || row.owner_token !== token) throw new AppError('NOT_FOUND', '分享不存在或凭证不匹配');
  await db.prepare('DELETE FROM shares WHERE code = ?1').bind(code).run();
  return { deleted: true };
}
