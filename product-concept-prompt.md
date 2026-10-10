# 产品概念图生成记录

- 用途：PRD 配套产品概念图，非前端页面、非 UI 原型。
- 生成过程：已尝试内置 image_gen 工具，但未返回可保存的本地文件；最终交付由 `render-concept.py` 生成 SVG，再使用现有运行环境中的 Sharp 渲染 PNG。没有使用图像 API 或 CLI 付费生成回退。
- 图片：`product-concept.png`，2400 × 1680。
- 可编辑图形源：`product-concept.svg`，通过 `render-concept.py` 可重建。
- 可编辑关系表达：`product-concept.mmd`；它是同一产品概念的关系描述，自动布局与 SVG 不必一致。
- 内容边界：抽象节点、多依赖、事件与产物回传、共享有效上下文、全局 Agent、人工介入、后台通知、组织及能力配置。

## 重建方式

在本目录运行 `python3 render-concept.py` 可重新生成 SVG；修改位置、文本与关系时，优先更新脚本后重建。PNG 由 SVG 渲染，保持内容一致。

## 初始图像提示词（生成尝试记录）

Use case: infographic-diagram.
Asset type: a polished Chinese product concept map accompanying a product requirements document. This is a conceptual systems diagram, NOT a web frontend, NOT an app screenshot, NOT a UI mockup.

Create one high resolution landscape diagram, approximately 3:2, white/off-white background, crisp flat vector-like shapes, refined editorial typography, very readable simplified Chinese, ample whitespace and carefully routed arrows. All labels must be accurate and legible. No brand logo, no decorative robots, no browser chrome, no navigation/sidebar, no buttons, no screenshot panels, no pseudo-code.

Title at top: "研发协作与上下文流转". Small subtitle: "产品概念图 · Web SaaS · 首期面向研发团队".

Arrange a large central diagram with supporting concepts at the sides:

1. Above the center is a blue rounded shape labelled "需求创造者" with small text "目标 · 约束 · 最终验收". A clearly labelled downward blue arrow "需求与约束" enters the central collaboration area. A separate strong upward blue arrow from the final node returns to this SAME creator, labelled "事件 + 最终产物". These two directions form the main delivery loop, without overlapping arrows.

2. The central large outlined area is labelled "项目 · 需求协作图" and in small text "用户自定义 · 抽象节点 · 随时增删改". Inside, three green rounded nodes on the left labelled "节点 A · Agent", "节点 B · Agent", and "节点 C · Agent" each have a smaller line "输入要求 / 产物". All three have separate clear rightward green arrows to a fourth node "节点 D · Agent", whose smaller text is "多依赖适配与交付". Put one short label "依赖产物" near these arrows. Use A/B/C/D only, not fixed roles like product/design/backend; they are generic configurable nodes. The return arrow to the creator starts from node D. The graph should not look like a fixed serial pipeline.

3. Directly below the collaboration area is a broad purple band titled "共享有效上下文" with text "目标 · 已确认决策 · 产物版本 · 进度 · 未决问题" and smaller text "来源可追溯 · 变化可识别". An arrow from the collaboration area into this band says "记录变化与交付"; a separate purple return arrow into the collaboration area says "复用有效上下文". Keep both directions unambiguous, not an unexplained two-headed line.

4. On the upper right is a purple supporting box titled "全局 Agent" and text "协调推进 · 宏观进度 · 交付情况". It is fed by the shared context band with a purple connector. A thin dashed connector from this box to the collaboration graph is labelled "按授权协调". It is not positioned as the sole source of truth and not depicted bypassing rules or human approval.

5. On the right of the collaboration area is a small orange loop with two shapes: "后台通知" with text "Web 待办 · 钉钉", and "人工介入" with text "补充信息 · 审批退回". A clearly routed orange arrow goes from the node graph to notifications labelled "缺关键 / 待审批", then to human intervention, then back into the graph labelled "补充或决定后继续". Human approval precedes formal rejection. Do not depict autonomous rejection without a person.

6. On the upper left is a neutral box "组织架构" with "人员 · 角色 · 职责" and a light dashed connector into the graph labelled "角色与责任". On the lower left is a neutral box "能力配置" with "MCP · Agent 内核 · 节点流水线" and a dashed connector into the graph. These are supporting capabilities, not mandatory workflow steps. Do not include Codex CLI or other coding-tool integrations.

At the bottom place the concise caption "需求驱动协作，事件与产物回传，成果交付创造者".
Color legend, small and clean: blue "需求与交付", green "节点依赖", purple "上下文复用", orange "人工介入".

Visual priorities: the creator-to-graph-to-creator delivery loop must be obvious; the three-to-one dependency example must be visible; shared context must support both individual nodes and global understanding; human intervention must visibly return to work. Avoid crossing connectors, excessive small text, fake metrics, fixed role types, giant database/server architecture, implementation frameworks, and any frontend interface elements.
