# Web 工作台 · 房间 ↔ API 映射规范

| 项目 | 内容 |
| --- | --- |
| 版本 | v0.1 · 接线前规范（待随 mockup 对齐更新） |
| 依据 | `docs/04-v02-design.md` §12（节点房间范式）、mockup v3.1、`src/interfaces/http/app.ts` |
| 目的 | 前端接线前，把 mockup 每个区域与后端端点/数据形状逐格对应；暴露并补齐缺失端点 |

---

## 0. 信息架构（mockup v3.1）

```
┌ 顶栏：面包屑（树 › 祖先 › 当前节点）· 树总览 · 全局 Agent 角标 · 运行示例 ┐
├ 左栏：树导航（以我为根，父子层级，当前房间高亮）──────────────┬─ 房间 ────┤
│                                                          │ 房头（名称/根节点/三态/owner/目标/验收）│
│                                                          │ 能力 actions（主展示：内核/SKILL/CI-CD）│
│                                                          │ 子树（下级房间入口卡）│
│                                                          │ 相邻消息（本节点视角的碎片流）│
│                                                          │ 产物与验收（O 版本链 + 通过/跳过/打回）│
├──────────────────────────────────────────────────────────┴───────────┤
│ 全局 Agent 面板：时间统计 / 提醒 / 碎片流（只读）                       │
└─────────────────────────────────────────────────────────────────────┘
```

**数据策略**：进入一棵树后，`GET /trees/:rootId` 一次取回全树快照（节点+状态+产物+输入+统计），前端在内存渲染「导航 + 任意房间」，切换房间无需再请求；仅交互动作（运行/验收/改写/配置）发 POST。

---

## 1. 区域 → 端点映射

| 区域 | 端点 | 关键字段（响应 → UI） |
| --- | --- | --- |
| 左栏树导航 | `GET /trees`、`GET /trees/:rootId` | `nodes[].id/name/parentId/status` → 层级与状态点；`rootId` 即「我」 |
| 顶栏面包屑 | 前端由 `parentId` 链计算 | 当前节点 → 祖先 → 树名 |
| 房头 | `GET /trees/:rootId` | `goal`、`acceptanceCriteria`、当前 `nodes[]`（`status/isSelf/mustVerify/visibility/description`） |
| 能力 actions（主展示） | `GET /trees/:rootId` 的 `nodes[].capabilities` + `GET /integrations` | `capabilities.agentKernel/skills/actions` → 卡片；`/integrations` → 内核/渠道「已配置」状态 |
| 添加/卸载能力 | `POST /trees/:rootId/nodes/:nodeId/capabilities` | `{actorId, capabilities}` → 更新后节点 |
| 子树（房间入口） | `GET /trees/:rootId` | `nodes[].parentId/status` + `products[nodeId]` 最新版本 + `stats[]` 等待时长 |
| 相邻消息 | `GET /trees/:rootId/ledger?limit=N` 前端过滤 | `fragment.fromId/toId === 当前节点`；`kind/payload/timestamp` → 碎片行 |
| 产物与验收 | `GET /trees/:rootId` 的 `products[nodeId]`；`POST /verdicts` | 版本链渲染；`{nodeId, productId, version, kind: pass/skip/return, reason}` |
| 运行节点能力 | `POST /trees/:rootId/run` | `{nodeId}` → 新产物（版本连续） |
| 根节点动作 | `POST /trees/:rootId/council` | `{action: deliver/rewrite/stop/prune, fragmentId?, targetNodeId?, content?, nodeId?}` |
| 可见性 | `POST /trees/:rootId/nodes/:nodeId/visibility` | `{actorId, visibility}` |
| 位置（树总览视图用） | `POST /trees/:rootId/position` | `{nodeId, x, y}` |
| 全局 Agent 面板 | `GET /trees/:rootId/global-agent/stats`、`POST /trees/:rootId/global-agent/check`、`GET /trees/:rootId/ledger`、`GET /trees/:rootId/todos` | 统计行 / 提醒卡 / 碎片流 / 待办 |
| 建树 / 建节点 / 输入 / 产物 | `POST /trees`、`POST /nodes`、`POST /inputs`（含 `ref` 跨树引用）、`POST /products` | 与后端测试一致 |

---

## 2. 交互清单（接入顺序）

| 优先级 | 交互 | 落点 |
| --- | --- | --- |
| P0 | 只读房间：树导航 + 面包屑 + 房头 + 能力卡 + 子树卡 + 相邻消息 + 产物链 + 全局 Agent 面板 | 纯 GET 渲染 |
| P1 | 运行（POST /run）→ 产物链刷新；验收（POST /verdicts）→ 状态/版本刷新 | 表单 → 刷新快照 |
| P2 | 根节点动作（改写/止步/剪枝，POST /council）；能力挂载/卸载；可见性切换 | 模态/内联表单 |
| P3 | 树总览视图（复用 /position 的自由画布）；建树/建节点/给输入/提产物 | 表单页 |

---

## 3. 前端文件结构（零构建，ES Modules）

```
web/
├── index.html      # 外壳：左栏 + 顶栏 + 房间 + 全局 Agent 面板
├── style.css       # 由已对齐的 mockup 直出
├── api.js          # fetch 封装（get/post）
├── model.js        # 树快照 → 房间视图模型（祖先链/子树/相邻碎片过滤/版本链）
├── room.js         # 房间渲染：能力卡/子树卡/消息流/产物链（按 mockup 结构）
└── app.js          # 装配：路由（当前房间）、事件绑定、全局 Agent 面板
```

---

## 4. 本轮补齐的端点（此前缺失）

| 端点 | 用途 | 守卫 |
| --- | --- | --- |
| `POST /trees/:rootId/nodes/:nodeId/capabilities` | 挂载/卸载 Agent 内核、SKILL、CI-CD 动作 | 仅节点创建者（owner） |
| `POST /trees/:rootId/nodes/:nodeId/visibility` | 私有/公有切换 | 仅节点创建者 |

- 领域层新增 `Node.changeCapabilities`（owner 守卫）、`Tree.changeCapabilities` 委托；
- 端到端测试「场景9」覆盖成功路径 + 非创建者拒绝 + 快照反映。

---

## 5. 已知边界（接线时处理）

- HTTP 暂无账户体系：`actorId` 由请求体传入（默认取节点 owner），身份认证为后续接入点（IdentityProvider 端口预留）。
- 「添加能力」目前 = 覆盖式更新 capabilities；增量挂载由前端表单拼接后提交。
- 全局 Agent 面板的「时间统计」tab 数据 = `/global-agent/stats`；「提醒」tab 数据 = `/todos` 中 `全局 Agent 提醒` 前缀 + `/global-agent/check` 触发。
