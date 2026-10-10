// flowstate · 前端交互
// 内核：把 /snapshot 渲染成一张深空节点图；点击节点查看有效上下文；一键生成示例流。

const $ = (id) => document.getElementById(id);
const stage = $('stage');

let lastSnapshot = { nodes: [], relations: [] };

const STATUS_COLOR = {
  待开始: '#8a97a8', 处理中: '#53e7ff', 等待人工: '#fbbf24',
  本轮结束: '#34d399', 已取消: '#f87171', 受阻: '#f87171',
  暂停: '#8a97a8', 执行异常: '#f87171',
};
const colorFor = (s) => STATUS_COLOR[s] || '#8a97a8';
const nodeClass = (s) =>
  'node' + (s === '处理中' ? ' active' : s === '等待人工' ? ' waiting' : s === '本轮结束' ? ' done' : '');

const TAG = { 原始材料: 'src', 人工确认: 'hum', AI分析: 'ai', 待确认: 'pend', 已失效: 'pend' };

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// ---- 图布局：按依赖深度分层（上游在左、下游在右）----
function layout(nodes, relations) {
  const deps = new Map(nodes.map((n) => [n.id, []]));
  for (const r of relations) {
    if (r.type === 'dependency' && deps.has(r.toNodeId)) deps.get(r.toNodeId).push(r.fromNodeId);
  }
  const depth = new Map();
  const calc = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const ups = deps.get(id) || [];
    const d = ups.length === 0 ? 0 : 1 + Math.max(...ups.map((u) => calc(u, seen)));
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => calc(n.id, new Set()));

  const byDepth = new Map();
  nodes.forEach((n) => {
    const d = depth.get(n.id);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(n);
  });
  const W = stage.clientWidth || 1200;
  const H = stage.clientHeight || 800;
  const padX = 120, padY = 90;
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const maxD = Math.max(...depths, 0);
  const pos = new Map();
  for (const d of depths) {
    const list = byDepth.get(d);
    list.forEach((n, i) => {
      const x = maxD === 0 ? W / 2 : padX + (d / maxD) * (W - 2 * padX);
      const y = padY + ((i + 0.5) / list.length) * (H - 2 * padY);
      pos.set(n.id, { x, y });
    });
  }
  return pos;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderGraph(snapshot) {
  lastSnapshot = snapshot;
  stage.innerHTML = '';
  const nodes = snapshot.nodes || [];
  const relations = snapshot.relations || [];
  const hint = $('empty-hint');
  if (nodes.length === 0) {
    if (!hint) {
      const d = document.createElement('div');
      d.className = 'empty-hint';
      d.id = 'empty-hint';
      d.innerHTML = '<div class="eh-title">THE GRID IS EMPTY</div><div class="eh-sub">点击右下角 + 生成一条示例协作流</div>';
      document.body.appendChild(d);
    }
    return;
  }
  if (hint) hint.remove();

  const svg = svgEl('svg', {});
  const defs = svgEl('defs', {});
  defs.innerHTML =
    '<filter id="glow" x="-300%" y="-300%" width="700%" height="700%">' +
    '<feGaussianBlur stdDeviation="5" result="b"/>' +
    '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  svg.appendChild(defs);

  const pos = layout(nodes, relations);
  for (const r of relations) {
    const a = pos.get(r.fromNodeId), b = pos.get(r.toNodeId);
    if (!a || !b) continue;
    const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: r.type === 'delivery' ? 'edge delivery' : 'edge' });
    svg.appendChild(line);
    if (r.type === 'dependency') {
      svg.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'edge-flow' }));
    }
  }
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const c = colorFor(n.executionStatus);
    const g = svgEl('g', { class: nodeClass(n.executionStatus), transform: `translate(${p.x},${p.y})`, 'data-id': n.id });
    g.appendChild(svgEl('circle', { r: 15, fill: 'none', stroke: c, 'stroke-width': 1.4, opacity: 0.5, filter: 'url(#glow)', class: 'node-glow' }));
    g.appendChild(svgEl('circle', { r: 5.5, fill: c, class: 'node-core' }));
    const label = svgEl('text', { y: 30, 'text-anchor': 'middle', class: 'node-label' });
    label.textContent = n.name || n.id;
    g.appendChild(label);
    g.addEventListener('click', () => openNode(n.id));
    svg.appendChild(g);
  }
  stage.appendChild(svg);
}

// ---- 详情面板 ----
function renderPanel(node, ctx) {
  const status = node ? node.executionStatus : '';
  const sec = (title, items) => {
    if (!items || items.length === 0) return '';
    const rows = items
      .map((it) => {
        const tag = TAG[it.kind] || 'src';
        return `<div class="p-item"><span class="tag ${tag}">${it.kind || ''}</span>${escapeHtml(it.content || '')}</div>`;
      })
      .join('');
    return `<div class="p-section"><h3>${title}</h3>${rows}</div>`;
  };
  return `
    <div class="p-head">
      <div class="p-status">${status || '—'}</div>
      <div class="p-name">${escapeHtml(node?.name || ctx.nodeId)}</div>
      <div class="p-id">${escapeHtml(ctx.nodeId)}</div>
      ${node?.description ? `<div class="p-desc">${escapeHtml(node.description)}</div>` : ''}
    </div>
    ${sec('目标与范围', ctx.goalAndScope)}
    ${sec('已确认输入', ctx.confirmedInputs)}
    ${sec('未决事项', ctx.openIssues)}
    ${sec('当前进展', ctx.progress)}
    ${sec('验收条件', ctx.acceptanceCriteria)}
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function openNode(id) {
  const ctx = await jsonFetch('/context/' + encodeURIComponent(id));
  const node = lastSnapshot.nodes.find((n) => n.id === id);
  $('panel-body').innerHTML = renderPanel(node, ctx);
  $('panel').classList.add('open');
  $('panel').setAttribute('aria-hidden', 'false');
}

// ---- 状态 ----
async function refreshState() {
  try {
    const [state, llm] = await Promise.all([jsonFetch('/state'), jsonFetch('/llm/status')]);
    $('stat-nodes').textContent = state.nodes;
    $('stat-artifacts').textContent = state.artifacts;
    $('stat-events').textContent = state.events;
    const llmPill = $('llm-pill'), llmLabel = $('llm-label');
    if (llm.configured) { llmPill.classList.add('on'); llmPill.classList.remove('off'); llmLabel.textContent = llm.model; }
    else { llmPill.classList.add('off'); llmPill.classList.remove('on'); llmLabel.textContent = 'LLM 未配置'; }
    const hp = $('health-pill'); hp.classList.add('on');
    $('hint-text').textContent = '就绪';
  } catch (e) {
    $('health-pill').classList.remove('on');
    $('hint-text').textContent = '服务不可达';
  }
}

async function refreshGraph() {
  const snap = await jsonFetch('/snapshot');
  renderGraph(snap);
}

// ---- 一键示例流 ----
async function runDemo() {
  const fab = $('run-demo');
  fab.classList.add('busy');
  $('hint-text').textContent = '生成示例协作流…';
  try {
    const post = (p, b) => jsonFetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const org = await post('/orgs', { name: '示例团队' });
    const project = await post('/projects', { orgId: org.id, name: '页面交付项目' });
    await post('/requirements', {
      projectId: project.id, goal: '交付一个可渲染页面', creatorId: 'pm',
      deliveryTarget: '页面可访问', scope: '一期', acceptanceCriteria: ['页面可访问', '符合验收规则'],
    });
    const base = {
      agentConfig: { kernel: 'deepseek', rolePrompt: '', tools: [], contextScope: '', uncertaintyStrategyId: '' },
      processingRules: { requireInputsBeforeStart: true, onMissingCriticalInput: 'notify_human' },
      pipeline: [],
    };
    const mk = (name, desc, inputs = [], pipeline = []) =>
      post('/nodes', { projectId: project.id, definition: { name, description: desc, participants: [], inputRequirements: inputs, expectedOutputs: [desc], agentConfig: base.agentConfig, processingRules: base.processingRules, pipeline } });
    const product = await mk('产品节点', '规则与验收要求');
    const backend = await mk('后端节点', '接口与约束');
    const design = await mk('设计节点', '交互与资源');
    const dev = await mk('研发节点', '把后端接口契约与设计资源渲染成页面',
      [
        { id: 'ir-api', description: '需要后端提供的接口契约', necessity: 'required', expectedForm: '文档', satisfyCondition: '包含字段与错误码定义' },
        { id: 'ir-design', description: '需要设计提供的交互与资源', necessity: 'required', expectedForm: '文件', satisfyCondition: '包含交互说明与切图' },
      ],
      [
        { id: 's1', type: 'check_input' },
        { id: 's2', type: 'agent_analyze' },
        { id: 's3', type: 'submit_artifact', config: { description: '页面产物 v1' } },
        { id: 's4', type: 'emit_event' },
      ]);
    await post('/relations', { projectId: project.id, type: 'dependency', fromNodeId: product.id, toNodeId: dev.id });
    await post('/relations', { projectId: project.id, type: 'dependency', fromNodeId: backend.id, toNodeId: dev.id });
    await post('/relations', { projectId: project.id, type: 'dependency', fromNodeId: design.id, toNodeId: dev.id });
    await post('/artifacts', { nodeId: product.id, submitterId: 'pm', description: 'PRD 与验收规则 v1' });
    await post('/artifacts', { nodeId: backend.id, submitterId: 'be', description: '接口契约与错误码定义 v1' });
    await post('/artifacts', { nodeId: design.id, submitterId: 'design', description: '交互稿与切图资源 v1' });
    await post('/pipeline/run', { nodeId: dev.id });
    $('hint-text').textContent = '示例流已生成';
    await Promise.all([refreshGraph(), refreshState()]);
  } catch (e) {
    $('hint-text').textContent = '生成失败：' + e.message;
  } finally {
    fab.classList.remove('busy');
  }
}

// ---- 初始化 ----
$('run-demo').addEventListener('click', runDemo);
$('panel-close').addEventListener('click', () => {
  $('panel').classList.remove('open');
  $('panel').setAttribute('aria-hidden', 'true');
});

(async function boot() {
  await refreshState();
  try { await refreshGraph(); } catch (e) { $('hint-text').textContent = '无法加载图：' + e.message; }
})();
