// agent-workflow · 图形客户端

const $ = (id) => document.getElementById(id);

let snapshot = { nodes: [], projects: [], relations: [] };
let selectedProject = null;
let currentView = 'overview';

// ---- 工具 ----
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(res.status + ' ' + path);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}
const get = (p) => api(p);
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

const STATUS_BADGE = {
  待开始: 'gray', 处理中: 'cyan', 等待人工: 'amber', 本轮结束: 'green',
  已取消: 'red', 受阻: 'red', 暂停: 'gray', 执行异常: 'red',
  草稿: 'gray', 进行中: 'cyan', 待最终验收: 'amber', 需修订: 'red', 已完结: 'green',
};
const badge = (s) => '<span class="badge ' + (STATUS_BADGE[s] || 'gray') + '">' + esc(s || '—') + '</span>';
const empty = (big, sub) =>
  '<div class="empty"><div class="big">' + esc(big) + '</div>' + esc(sub) + '</div>';

// ---- 视图 ----
async function renderOverview() {
  const view = $('view');
  if (!selectedProject) {
    view.innerHTML = empty('还没有项目', '点击右上角「运行示例」生成一条协作流');
    return;
  }
  const s = await get('/project/' + selectedProject.id + '/summary');
  const reqRows = s.requirements.map((r) =>
    '<li class="row"><span class="r-name">' + esc(r.goal) + '</span>' + badge(r.status) + '</li>').join('');
  const blockRows = s.blockers.length === 0
    ? '<div class="empty">（无阻塞）</div>'
    : '<ul class="row-list">' + s.blockers.map((b) => {
        const label = b.type === 'intervention' ? (b.gap || b.name || b.nodeId) : (b.name || b.nodeId) + ' · ' + (b.status || '');
        return '<li class="row"><span class="r-name">' + esc(label) + '</span>' + badge(b.status) + '</li>';
      }).join('') + '</ul>';

  view.innerHTML =
    '<div class="card"><div class="card-title">' + esc(s.name) + '</div>' +
    '<div class="stats">' +
    '<div class="stat"><div class="v">' + s.nodes.length + '</div><div class="k">节点</div></div>' +
    '<div class="stat"><div class="v">' + s.artifactCount + '</div><div class="k">产物</div></div>' +
    '<div class="stat"><div class="v">' + s.blockers.length + '</div><div class="k">阻塞</div></div>' +
    '<div class="stat"><div class="v">' + s.requirements.length + '</div><div class="k">需求</div></div>' +
    '</div></div>' +
    '<div class="card"><div class="card-title">需求</div><ul class="row-list">' + reqRows + '</ul></div>' +
    '<div class="card"><div class="card-title">阻塞</div>' + blockRows + '</div>';
}

async function renderNodes() {
  const view = $('view');
  const nodes = snapshot.nodes || [];
  if (nodes.length === 0) {
    view.innerHTML = empty('还没有节点', '运行示例后这里会列出协作节点');
    return;
  }
  view.innerHTML =
    '<div class="card"><div class="card-title">节点（' + nodes.length + '）</div><ul class="row-list">' +
    nodes.map((n) =>
      '<li class="row" data-node="' + esc(n.id) + '"><span class="r-name">' + esc(n.name) + '</span>' +
      badge(n.executionStatus) + '<span class="r-id">' + esc(n.id) + '</span></li>').join('') +
    '</ul></div>';
  view.querySelectorAll('.row[data-node]').forEach((el) =>
    el.addEventListener('click', () => openDrawer(el.dataset.node)));
}

async function renderConnections() {
  const view = $('view');
  const intg = await get('/integrations/status');
  const row = (name, detail, configured, env) =>
    '<div class="row" style="cursor:default"><span class="r-name">' + esc(name) + '</span>' +
    '<span class="r-id">' + esc(detail) + '</span>' +
    (configured ? badge2('已配置', 'green') : badge2('未配置', 'amber')) + '</div>' +
    (configured ? '' : '<div style="font-size:12px;color:var(--faint);padding:2px 4px 10px">设置环境变量 ' + esc(env) + '</div>');
  view.innerHTML =
    '<div class="card"><div class="card-title">连接配置</div>' +
    row('LLM', intg.llm.model, intg.llm.configured, 'DEEPSEEK_API_KEY') +
    row('MCP', '工具服务器', intg.mcp.configured, 'MCP_ENDPOINT') +
    row('钉钉', '通知渠道', intg.dingtalk.configured, 'DINGTALK_WEBHOOK') +
    '</div>';
}
const badge2 = (t, color) => '<span class="badge ' + color + '">' + t + '</span>';

function renderCurrent() {
  if (currentView === 'overview') return renderOverview();
  if (currentView === 'nodes') return renderNodes();
  if (currentView === 'connections') return renderConnections();
}

// ---- 抽屉（节点详情 + 有效上下文）----
async function openDrawer(nodeId) {
  const node = snapshot.nodes.find((n) => n.id === nodeId);
  const ctx = await get('/context/' + encodeURIComponent(nodeId));
  const sec = (title, items) => {
    if (!items || items.length === 0) return '';
    return '<div class="d-section"><h3>' + esc(title) + '</h3>' + items.map((it) =>
      '<div class="ctx"><div class="kind">' + esc(it.kind || '') + '</div><div class="body">' + esc(it.content) + '</div></div>'
    ).join('') + '</div>';
  };
  $('drawer-body').innerHTML =
    '<div class="d-head">' +
    '<div class="d-title">' + esc(node?.name || nodeId) + '</div>' +
    '<div class="d-id">' + esc(nodeId) + '</div>' +
    (node?.executionStatus ? '<div style="margin-top:10px">' + badge(node.executionStatus) + '</div>' : '') +
    (node?.description ? '<div class="d-desc">' + esc(node.description) + '</div>' : '') +
    '</div>' +
    sec('目标与范围', ctx.goalAndScope) +
    sec('已确认输入', ctx.confirmedInputs) +
    sec('未决事项', ctx.openIssues) +
    sec('当前进展', ctx.progress) +
    sec('验收条件', ctx.acceptanceCriteria);
  $('drawer').classList.add('open');
  $('scrim').classList.add('open');
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('scrim').classList.remove('open');
}

// ---- 运行示例 ----
async function runDemo() {
  const btn = $('run');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '运行中…';
  try {
    const intg = await get('/integrations/status').catch(() => ({ llm: { configured: false } }));
    const kernel = intg.llm.configured ? 'deepseek' : 'demo-agent';

    const org = await post('/orgs', { name: '示例团队' });
    const project = await post('/projects', { orgId: org.id, name: '页面交付项目' });
    await post('/requirements', { projectId: project.id, goal: '交付一个可渲染页面', creatorId: 'pm', deliveryTarget: '页面可访问', scope: '一期', acceptanceCriteria: ['页面可访问', '符合验收规则'] });

    const base = {
      agentConfig: { kernel, rolePrompt: '', tools: [], contextScope: '', uncertaintyStrategyId: '' },
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

    await refreshAll();
  } catch (e) {
    alert('运行失败：' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ---- 侧边栏 ----
function renderProjectList() {
  const ul = $('project-list');
  const projects = snapshot.projects || [];
  if (projects.length === 0) {
    ul.innerHTML = '<li class="empty">暂无项目</li>';
    return;
  }
  ul.innerHTML = projects.map((p) =>
    '<li data-project="' + esc(p.id) + '" class="' + (selectedProject?.id === p.id ? 'active' : '') + '">' + esc(p.name) + '</li>').join('');
  ul.querySelectorAll('li[data-project]').forEach((el) =>
    el.addEventListener('click', () => {
      selectedProject = snapshot.projects.find((p) => p.id === el.dataset.project);
      renderProjectList();
      renderCurrent();
    }));
}

function renderLlmPill(intg) {
  const pill = $('llm-pill');
  const label = $('llm-label');
  if (intg.llm.configured) { pill.classList.add('on'); pill.classList.remove('off'); label.textContent = intg.llm.model; }
  else { pill.classList.add('off'); pill.classList.remove('on'); label.textContent = 'LLM 未配置'; }
}

async function refreshAll() {
  snapshot = await get('/snapshot');
  const intg = await get('/integrations/status');
  renderLlmPill(intg);
  renderProjectList();
  if (!selectedProject && snapshot.projects && snapshot.projects.length) {
    selectedProject = snapshot.projects[0];
    renderProjectList();
  }
  await renderCurrent();
}

// ---- 导航 ----
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    $('view-title').textContent = { overview: '概览', nodes: '节点', connections: '连接' }[currentView];
    renderCurrent();
  });
});

$('run').addEventListener('click', runDemo);
$('drawer-close').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', closeDrawer);

// ---- 启动 ----
refreshAll().catch((e) => { $('view').innerHTML = empty('无法连接服务', e.message); });
