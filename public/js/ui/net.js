// @ts-check
/**
 * CitationGraph（REBUILD_PLAN 5.11.2 / M3-04）：
 * canvas 力导向图 ≤30 节点 1 跳；hover 显标题、点击跳 /p/:id；必须提供列表视图替身（无障碍）。
 * 性能：布局预计算（~120 次迭代）+ rAF 仅在拖拽/冷却时重绘；主线程内 30 节点足够 60fps。
 */

/**
 * @typedef {{ id: string, title: string, year?: number, citations?: number, kind: 'center' | 'ref' | 'cited' | 'similar' }} GraphNode
 * @typedef {{ source: number, target: number }} GraphEdge
 */

/**
 * @param {{ center: any, references: any[], citedBy: any[], similar?: any[] }} data
 * @param {{ maxNodes?: number }} [opts]
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[] }}
 */
export function buildGraphData(data, opts = {}) {
  const max = opts.maxNodes ?? 30;
  /** @type {GraphNode[]} */
  const nodes = [];
  /** @type {GraphEdge[]} */
  const edges = [];
  const seen = new Set();

  const push = (/** @type {any} */ w, /** @type {GraphNode['kind']} */ kind) => {
    const id = w.id || w.doi || `x-${nodes.length}`;
    if (seen.has(id) || nodes.length >= max) return null;
    seen.add(id);
    const node = { id, title: String(w.title ?? ''), year: w.year, citations: w.citations, kind };
    nodes.push(node);
    return nodes.length - 1;
  };

  const centerIdx = push(data.center, 'center');
  if (centerIdx === null) return { nodes, edges };

  for (const r of (data.references ?? []).slice(0, 12)) {
    const i = push(r, 'ref');
    if (i !== null) edges.push({ source: centerIdx, target: i });
  }
  for (const r of (data.citedBy ?? []).slice(0, 12)) {
    const i = push(r, 'cited');
    if (i !== null) edges.push({ source: centerIdx, target: i });
  }
  for (const s of (data.similar ?? []).slice(0, 5)) {
    push(s, 'similar'); // 无边——邻域外虚线可扩展（M8）
  }
  return { nodes, edges };
}

/**
 * 力导向布局（预计算）
 * @param {GraphNode[]} nodes
 * @param {GraphEdge[]} edges
 * @param {{ width: number, height: number }} canvas
 * @returns {{ x: number, y: number, vx: number, vy: number }[]}
 */
export function layout(nodes, edges, canvas) {
  const { width, height } = canvas;
  const pts = nodes.map((_, i) => ({
    x: width / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * width * 0.3,
    y: height / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * height * 0.3,
    vx: 0, vy: 0,
  }));
  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1)) * 0.6; // 理想边长
  for (let iter = 0; iter < 120; iter++) {
    // 斥力（O(n²)，n≤30 可接受）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const d2 = Math.max(dx * dx + dy * dy, 100);
        const f = (k * k) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        pts[i].vx -= fx; pts[i].vy -= fy;
        pts[j].vx += fx; pts[j].vy += fy;
      }
    }
    // 引力（边）
    for (const e of edges) {
      const a = pts[e.source];
      const b = pts[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - k) * 0.05;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // 中心引力 + 限速
    for (const p of pts) {
      p.vx += (width / 2 - p.x) * 0.01;
      p.vy += (height / 2 - p.y) * 0.01;
      p.vx *= 0.85; p.vy *= 0.85;
      p.x += Math.max(-15, Math.min(15, p.vx));
      p.y += Math.max(-15, Math.min(15, p.vy));
      p.x = Math.max(30, Math.min(width - 30, p.x));
      p.y = Math.max(24, Math.min(height - 24, p.y));
    }
  }
  return pts;
}

const KIND_COLORS = { center: '#B8791A', ref: '#2A5DB0', cited: '#2E7D4F', similar: '#6E747D' };

/**
 * 挂载 canvas 交互图（hover tooltip / 点击跳转 / 拖拽）
 * @param {HTMLElement} container
 * @param {ReturnType<typeof buildGraphData>} graph
 * @param {{ width: number, height: number }} size
 * @param {{ onOpen?: (id: string) => void }} [opts]
 */
export function mountGraph(container, graph, size, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size.width * (window.devicePixelRatio || 1);
  canvas.height = size.height * (window.devicePixelRatio || 1);
  canvas.style.width = size.width + 'px';
  canvas.style.height = size.height + 'px';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `引文网络图：${graph.nodes.length} 篇论文。列表视图提供无障碍替代。`);
  container.appendChild(canvas);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const pts = layout(graph.nodes, graph.edges, size);
  let hoverIdx = -1;
  let dragIdx = -1;
  let needsRedraw = true;

  function draw() {
    ctx.clearRect(0, 0, size.width, size.height);
    // 边
    ctx.strokeStyle = 'rgba(110,116,125,0.4)';
    ctx.lineWidth = 1;
    for (const e of graph.edges) {
      const a = pts[e.source];
      const b = pts[e.target];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // 节点
    graph.nodes.forEach((n, i) => {
      const p = pts[i];
      const r = n.kind === 'center' ? 10 : Math.max(4, Math.min(9, Math.sqrt(n.citations ?? 0) / 4));
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = KIND_COLORS[n.kind] ?? '#6E747D';
      ctx.fill();
      if (i === hoverIdx) {
        ctx.strokeStyle = '#B8791A';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (n.kind === 'center') {
        ctx.strokeStyle = '#FBFAF8';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    // hover 标题
    if (hoverIdx >= 0) {
      const n = graph.nodes[hoverIdx];
      const p = pts[hoverIdx];
      ctx.font = '12px sans-serif';
      const text = n.title.slice(0, 46) + (n.title.length > 46 ? '…' : '');
      const tw = ctx.measureText(text).width;
      const bx = Math.min(p.x + 12, size.width - tw - 16);
      const by = Math.max(p.y - 28, 4);
      ctx.fillStyle = 'rgba(17,20,24,0.92)';
      ctx.fillRect(bx - 4, by - 4, tw + 8, 22);
      ctx.fillStyle = '#FBFAF8';
      ctx.fillText(text, bx, by + 10);
    }
  }

  function requestDraw() {
    if (!needsRedraw) return;
    needsRedraw = false;
    draw();
  }
  function invalidate() {
    needsRedraw = true;
    requestAnimationFrame(requestDraw);
  }

  /** @param {MouseEvent | Touch} e */
  const hitTest = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (let i = pts.length - 1; i >= 0; i--) {
      const dx = pts[i].x - x;
      const dy = pts[i].y - y;
      if (dx * dx + dy * dy < 144) return i;
    }
    return -1;
  };

  /** @param {MouseEvent} e */
  const onMouseMove = (e) => {
    const i = hitTest(/** @type {MouseEvent} */ (e));
    if (i !== hoverIdx) {
      hoverIdx = i;
      canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
      invalidate();
    } else if (dragIdx >= 0) {
      const rect = canvas.getBoundingClientRect();
      pts[dragIdx].x = e.clientX - rect.left;
      pts[dragIdx].y = e.clientY - rect.top;
      invalidate();
    }
  };
  /** @param {MouseEvent} e */
  const onMouseDown = (e) => {
    dragIdx = hitTest(/** @type {MouseEvent} */ (e));
    if (dragIdx >= 0) e.preventDefault();
  };
  const onMouseUp = () => { dragIdx = -1; };
  /** @param {MouseEvent} e */
  const onClick = (e) => {
    const i = hitTest(/** @type {MouseEvent} */ (e));
    if (i >= 0 && graph.nodes[i].id && graph.nodes[i].kind !== 'similar') {
      opts.onOpen?.(graph.nodes[i].id);
    }
  };

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('click', onClick);
  draw();

  return {
    destroy() {
      canvas.remove();
    },
  };
}
