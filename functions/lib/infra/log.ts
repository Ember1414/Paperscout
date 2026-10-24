/**
 * 结构化日志（REBUILD_PLAN 7.3 中间件第 7 步 / 7.8 可观测性）。
 * 输出单行 JSON：{ lvl, rid, route, ts, ...fields }，供 Workers 日志流检索。
 */

export type LogFields = Record<string, unknown>;

/** 字段必须为可 JSON 化的平面对象；序列化失败时降级为占位符并显式告警（不静默） */
function serialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    console.warn('log:unserializable-fields');
    return '"unserializable"';
  }
}

function emit(lvl: 'info' | 'warn' | 'error', rid: string, route: string, fields: LogFields) {
  const line = serialize({ lvl, rid, route, ts: Date.now(), ...fields });
  if (lvl === 'error') console.error(line);
  else if (lvl === 'warn') console.warn(line);
  else console.log(line);
}

export function logInfo(rid: string, route: string, fields: LogFields = {}): void {
  emit('info', rid, route, fields);
}

export function logWarn(rid: string, route: string, fields: LogFields = {}): void {
  emit('warn', rid, route, fields);
}

export function logError(rid: string, route: string, fields: LogFields = {}): void {
  emit('error', rid, route, fields);
}

/** 8 位短请求 ID（7.3 中间件第 1 步），同请求全链路透传 */
export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
