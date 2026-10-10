// agent-workflow · 终端式交互（Claude Code 风格）

const out = document.getElementById('output');
const form = document.getElementById('input-line');
const input = document.getElementById('input');
const prompt = document.getElementById('prompt');

const history = [];
let histIdx = -1;

// ---- 渲染工具 ----
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function append(html) {
  const div = document.createElement('div');
  div.className = 'block';
  div.innerHTML = html;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}
function line(html) { append('<div class="line">' + html + '</div>'); }
function blank() { append('<div></div>'); }
function span(text, color) { return '<span class="c-' + color + '">' + esc(text) + '</span>'; }

const STATUS = {
  待开始: ['○', 'dim'], 处理中: ['●', 'cyan'], 等待人工: ['●', 'amber'], 本轮结束: ['●', 'green'],
  已取消: ['●', 'red'], 受阻: ['●', 'red'], 暂停: ['○', 'dim'], 执行异常: ['●', 'red'],
  草稿: ['○', 'dim'], 进行中: ['●', 'cyan'], 待最终验收: ['●', 'amber'], 需修订: ['●', 'red'], 已完结: ['●', 'green'],
  已接受: ['●', 'green'], 需复验: ['●', 'amber'],
};
function glyph(s) {
  const [ch, color] = STATUS[s] || ['○', 'dim'];
  return span(ch + ' ' + (s || '—'), color);
}

// ---- API ----
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(res.status + ' ' + path);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}
const get = (p) => api(p);
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

// ---- 命令 ----
const commands = {
  '/help': () => {
    append('<div class="h1">可用命令</div>');
    const rows = [
      ['/status', '系统状态（节点 / 产物 / 事件 + 连接配置）'],
      ['/run', '运行示例协作流（组织→项目→需求→节点→产物→流水线）'],
      ['/nodes', '列出所有节点'],
      ['/context <id>', '查看节点有效上下文'],
      ['/summary', '项目宏观看板（目标 / 阻塞 / 交付汇总）'],
      ['/llm', 'LLM / MCP / 钉钉 配置状态'],
      ['/clear', '清屏'],
    ];
    for (const [c, d] of rows) line('  ' + span(c, 'cyan') + '  <span class="c-dim">' + esc(d) + '</span>');
    blank();
    line('<span class="c-dim">↑↓ 浏览历史 · 直接输入命令执行</span>');
  },

  '/status': async () => {
    const [state, intg] = await Promise.all([get('/state'), get('/integrations/status')]);
    append('<div class="h1">系统状态</div>');
    line('  节点 ' + span(state.nodes, 'fg') + ' · 产物 ' + span(state.artifacts, 'fg') + ' · 事件 ' + span(state.events, 'fg'));
    blank();
    append('<div class="h2">连接</div>');
    line('  LLM      ' + span(intg.llm.model, 'fg') + '  ' + (intg.llm.configured ? span('已配置', 'green') : span('未配置', 'amber')));
    line('  MCP      ' + (intg.mcp.configured ? span('已配置', 'green') : span('未配置', 'dim')));
    line('  DingTalk ' + (intg.dingtalk.configured ? span('已配置', 'green') : span('未配置', 'dim')));
  },

  '/nodes': async () => {
    const snap = await get('/snapshot');
    const nodes = snap.nodes || [];
    append('<div class="h1">节点（' + nodes.length + '）</div>');
    if (nodes.length === 0) { line(span('  （空）用 /run 生成示例', 'dim')); return; }
    for (const n of nodes) {
      line('  ' + glyph(n.executionStatus) + '  ' + span(n.name, 'fg') + '  <span class="c-dim">' + esc(n.id) + '</span>');
    }
  },

  '/context': async (id) => {
    if (!id) { line(span('用法：/context <节点id>（先 /nodes 查 id）', 'red')); return; }
    const ctx = await get('/context/' + encodeURIComponent(id));
    append('<div class="h1">有效上下文 · ' + esc(ctx.nodeId) + '</div>');
    section('目标与范围', ctx.goalAndScope);
    section('已确认输入', ctx.confirmedInputs);
    section('未决事项', ctx.openIssues);
    section('当前进展', ctx.progress);
    section('验收条件', ctx.acceptanceCriteria);
  },

  '/summary': async () => {
    const snap = await get('/snapshot');
    const projectId = snap.projects?.[0]?.id;
    if (!projectId) { line(span('  无项目，先用 /run 生成', 'dim')); return; }
    const s = await get('/project/' + projectId + '/summary');
    append('<div class="h1">宏观看板 · ' + esc(s.name) + '</div>');
    append('<div class="h2">需求</div>');
    for (const r of s.requirements) line('  ' + glyph(r.status) + '  ' + esc(r.goal));
    append('<div class="h2">阻塞</div>');
    if (s.blockers.length === 0) line(span('  （无）', 'dim'));
    for (const b of s.blockers) {
      const extra = b.type === 'intervention' ? esc(b.gap || '') : glyph(b.status || '');
      line('  ' + span('⚠', 'amber') + ' ' + esc(b.name || b.nodeId) + '  ' + extra);
    }
    blank();
    line('<span class="c-dim">产物 ' + s.artifactCount + ' · 最近事件 ' + s.recentEvents.length + '</span>');
  },

  '/llm': async () => {
    const intg = await get('/integrations/status');
    append('<div class="h1">连接配置</div>');
    line('  LLM      ' + span(intg.llm.model, 'fg') + '  ' + (intg.llm.configured ? span('✓ 已配置', 'green') : span('✗ 未配置（设 DEEPSEEK_API_KEY）', 'amber')));
    line('  MCP      ' + (intg.mcp.configured ? span('✓ 已配置', 'green') : span('✗ 未配置（设 MCP_ENDPOINT）', 'dim')));
    line('  DingTalk ' + (intg.dingtalk.configured ? span('✓ 已配置', 'green') : span('✗ 未配置（设 DINGTALK_WEBHOOK）', 'dim')));
  },

  '/clear': () => { out.innerHTML = ''; },
};

function section(title, items) {
  append('<div class="h2">' + esc(title) + '</div>');
  if (!items || items.length === 0) { line(span('  （无）', 'dim')); return; }
  const tagColor = { 原始材料: 'green', 人工确认: 'cyan', AI分析: 'purple', 待确认: 'amber', 已失效: 'dim' };
  for (const it of items) {
    const c = tagColor[it.kind] || 'dim';
    line('  <span class="c-dim">[</span>' + span(it.kind || '', c) + '<span class="c-dim">]</span> ' + esc(it.content));
  }
}

async function runDemo() {
  const step = (t) => line(span('▸', 'cyan') + ' ' + esc(t));
  // 根据 LLM 是否配置选择内核，保证离线也能跑通
  const intg = await get('/integrations/status').catch(() => ({ llm: { configured: false } }));
  const kernel = intg.llm.configured ? 'deepseek' : 'demo-agent';

  step('创建组织 示例团队');
  const org = await post('/orgs', { name: '示例团队' });
  step('创建项目 页面交付项目');
  const project = await post('/projects', { orgId: org.id, name: '页面交付项目' });
  step('创建需求');
  await post('/requirements', { projectId: project.id, goal: '交付一个可渲染页面', creatorId: 'pm', deliveryTarget: '页面可访问', scope: '一期', acceptanceCriteria: ['页面可访问', '符合验收规则'] });

  const base = {
    agentConfig: { kernel, rolePrompt: '', tools: [], contextScope: '', uncertaintyStrategyId: '' },
    processingRules: { requireInputsBeforeStart: true, onMissingCriticalInput: 'notify_human' },
    pipeline: [],
  };
  const mk = (name, desc, inputs = [], pipeline = []) =>
    post('/nodes', { projectId: project.id, definition: { name, description: desc, participants: [], inputRequirements: inputs, expectedOutputs: [desc], agentConfig: base.agentConfig, processingRules: base.processingRules, pipeline } });

  step('创建节点 产品 / 后端 / 设计 / 研发');
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

  step('建立依赖关系');
  await post('/relations', { projectId: project.id, type: 'dependency', fromNodeId: product.id, toNodeId: dev.id });
  await post('/relations', { projectId: project.id, type: 'dependency', fromNodeId: backend.id, toNodeId: dev.id });
  await post('/relations', { projectId: project.id, type: 'dependency', fromNodeId: design.id, toNodeId: dev.id });

  step('提交上游产物');
  await post('/artifacts', { nodeId: product.id, submitterId: 'pm', description: 'PRD 与验收规则 v1' });
  await post('/artifacts', { nodeId: backend.id, submitterId: 'be', description: '接口契约与错误码定义 v1' });
  await post('/artifacts', { nodeId: design.id, submitterId: 'design', description: '交互稿与切图资源 v1' });

  step('运行研发节点流水线');
  const run = await post('/pipeline/run', { nodeId: dev.id });
  line('  ' + (run.status === 'done' ? span('✓ 流水线完成', 'green') : span('✗ ' + run.status, 'red')));
  blank();
  line(span('下一步：/nodes · /context ' + dev.id + ' · /summary', 'dim'));
}

// ---- 输入处理 ----
async function dispatch(raw) {
  const t = raw.trim();
  if (!t) return;
  const i = t.indexOf(' ');
  const cmd = i === -1 ? t : t.slice(0, i);
  const arg = i === -1 ? '' : t.slice(i + 1);
  const fn = commands[cmd];
  if (fn) {
    try { await fn(arg); }
    catch (e) { line(span('✗ ' + (e.message || e), 'red')); }
  } else if (cmd.startsWith('/')) {
    line(span('未知命令：' + cmd + '（/help 查看）', 'red'));
  } else {
    line(span('·', 'dim') + ' ' + esc(t) + '  —  ' + span('输入 /help 查看可用命令', 'dim'));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = input.value;
  append('<div class="line">' + span('❯', 'green') + ' ' + esc(t) + '</div>');
  if (t.trim()) history.push(t);
  histIdx = history.length;
  input.value = '';
  prompt.classList.add('busy');
  input.disabled = true;
  await dispatch(t);
  input.disabled = false;
  prompt.classList.remove('busy');
  input.focus();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (history.length === 0) return;
    histIdx = Math.max(0, histIdx - 1);
    input.value = history[histIdx];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    histIdx = Math.min(history.length, histIdx + 1);
    input.value = histIdx < history.length ? history[histIdx] : '';
  } else if (e.key === 'Escape') {
    input.value = '';
  }
});

document.addEventListener('click', () => input.focus());

// ---- 启动 ----
function boot() {
  append('<div class="h1">agent-workflow</div>');
  append('<div class="h2">研发协作与上下文流转平台 · 终端</div>');
  blank();
  line('<span class="c-dim">输入</span> ' + span('/help', 'cyan') + ' <span class="c-dim">查看命令 ·</span> ' + span('/run', 'cyan') + ' <span class="c-dim">生成示例协作流</span>');
  blank();
  input.focus();
}
boot();
