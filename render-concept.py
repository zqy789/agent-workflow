"""Rebuild the editable SVG concept diagram; uses only Python's standard library."""
from pathlib import Path
from html import escape

ROOT = Path(__file__).resolve().parent
parts = ['''<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1680" viewBox="0 0 2400 1680" role="img" aria-labelledby="title desc">
<title id="title">研发协作与上下文流转：产品概念图</title>
<desc id="desc">组织提供角色与责任，需求创造者提出目标。自定义图中多个节点的产物汇入接收节点，由节点 Agent 适配。共享有效上下文支持各节点和全局 Agent。缺少关键信息时后台通知人工，补充或审批后继续，最终事件和产物回到需求创造者。</desc>
<defs>
  <marker id="blue" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#376BC5"/></marker>
  <marker id="green" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#428E76"/></marker>
  <marker id="purple" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#9273AE"/></marker>
  <marker id="orange" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#CC873C"/></marker>
  <marker id="gray" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#A2ACB8"/></marker>
</defs>
<rect width="2400" height="1680" fill="#F7F9FC"/>
''']
COLORS = {'blue': '#376BC5', 'green': '#428E76', 'purple': '#9273AE', 'orange': '#CC873C', 'gray': '#A2ACB8'}


def rect(x, y, w, h, fill, stroke, r=24):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')


def text(x, y, content, size=30, fill='#26364B', weight=400, anchor='start'):
    parts.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{fill}" font-family="Hiragino Sans GB, Arial, sans-serif" font-size="{size}" font-weight="{weight}">{escape(content)}</text>')


def arrow(path, color, width=4, dashed=False):
    dash = ' stroke-dasharray="10 10"' if dashed else ''
    parts.append(f'<path d="{path}" fill="none" stroke="{COLORS[color]}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"{dash} marker-end="url(#{color})"/>')


def label(x, y, content, color, width, size=27):
    parts.append(f'<rect x="{x-width/2}" y="{y-size}" width="{width}" height="{size+10}" rx="9" fill="#F7F9FC"/>')
    text(x, y, content, size, COLORS[color], anchor='middle')


# Header and conceptual container.
text(100, 80, 'PRODUCT CONCEPT / v0.1', 25, '#70809A', 600)
text(100, 170, '研发协作与上下文流转', 64, '#182B48', 600)
text(103, 223, 'Web SaaS · 首期研发团队 · 人与 Agent 共同完成交付', 30, '#697B92')
rect(565, 555, 1270, 585, '#FFFFFF', '#D8E2EB', 32)
text(615, 618, '项目 · 需求协作图', 40, '#253952', 600)
text(616, 660, '用户自定义 · 抽象节点 · 随时增删改', 27, '#76879A')

# Connectors are drawn before cards and labels.
arrow('M 1200 430 L 1200 555', 'blue', 5)
arrow('M 1475 849 L 1475 720 L 1795 720 L 1795 357 L 1485 357', 'blue', 5)
arrow('M 465 585 L 565 585', 'gray', 3, True)
arrow('M 465 1012 L 565 1012', 'gray', 3, True)
arrow('M 1025 761 L 1110 761 L 1110 885 L 1260 885', 'green')
arrow('M 1025 906 L 1260 906', 'green')
arrow('M 1025 1051 L 1140 1051 L 1140 953 L 1260 953', 'green')
arrow('M 1000 1140 L 1000 1230', 'purple')
arrow('M 1430 1230 L 1430 1140', 'purple')
arrow('M 1835 1330 L 2340 1330 L 2340 400 L 2305 400', 'purple', 3)
arrow('M 1925 440 L 1860 440 L 1860 520 L 1650 520 L 1650 555', 'purple', 3, True)
arrow('M 1690 925 L 1855 925 L 1855 715 L 1930 715', 'orange')
arrow('M 2120 780 L 2120 845', 'orange')
arrow('M 1930 970 L 1880 970 L 1880 1095 L 1475 1095 L 1475 1009', 'orange')

# Demand origin and final recipient are the same actor.
rect(915, 285, 570, 145, '#EAF1FE', '#A2BDE8')
text(1200, 346, '需求创造者', 42, '#254C8B', 600, 'middle')
text(1200, 394, '目标 · 约束 · 最终验收', 28, '#57739D', anchor='middle')

# Organisational and configuration dimensions are capabilities, not workflow steps.
rect(95, 480, 370, 195, '#F0F3F7', '#D5DDE6')
text(129, 542, '组织架构', 37, '#3C4E65', 600)
text(129, 591, '人员 · 角色 · 职责', 28, '#66788E')
text(129, 638, '为项目分配协作责任', 25, '#66788E')
rect(95, 900, 370, 225, '#F0F3F7', '#D5DDE6')
text(129, 961, '能力配置', 37, '#3C4E65', 600)
text(129, 1010, 'MCP 工具连接', 28, '#66788E')
text(129, 1052, '可配置 Agent 内核', 28, '#66788E')
text(129, 1094, '任意节点流水线', 28, '#66788E')

# Abstract collaboration graph: three independent inputs converge.
for name, y in [('A', 705), ('B', 850), ('C', 995)]:
    rect(655, y, 370, 112, '#EAF6F1', '#95C7B5', 20)
    text(840, y+47, f'节点 {name} · Agent', 32, '#285D4B', 600, 'middle')
    text(840, y+85, '输入要求 / 产物', 25, '#628475', anchor='middle')
rect(1260, 849, 430, 160, '#DFF1E9', '#71B298', 24)
text(1475, 912, '节点 D · Agent', 37, '#245743', 600, 'middle')
text(1475, 965, '多依赖适配与交付', 29, '#567B6C', anchor='middle')

# Shared context keeps source material and confirmed information useful.
rect(565, 1230, 1270, 200, '#F0ECF7', '#C6B4DA', 28)
text(610, 1295, '共享有效上下文', 43, '#634780', 600)
text(610, 1351, '目标 · 已确认决策 · 产物版本 · 进度 · 未决问题', 31, '#816595')
text(610, 1396, '保留来源，识别变化，复用已确认信息', 26, '#9581A4')

# Whole-project understanding and configurable coordination.
rect(1925, 300, 380, 200, '#F0ECF7', '#C6B4DA')
text(1960, 363, '全局 Agent', 38, '#634780', 600)
text(1960, 413, '协调推进 · 宏观进度', 28, '#816595')
text(1960, 458, '阻塞与交付汇总', 28, '#816595')

# The normal human-in-the-loop path.
rect(1930, 650, 380, 130, '#FFF2E3', '#E2BD8D', 22)
text(2120, 704, '后台通知', 35, '#9B652E', 600, 'middle')
text(2120, 749, 'Web 待办 · 钉钉', 28, '#AA7A47', anchor='middle')
rect(1930, 845, 380, 180, '#FFF2E3', '#E2BD8D', 22)
text(2120, 902, '人工介入', 36, '#9B652E', 600, 'middle')
text(2120, 953, '补充信息 · 审批退回', 28, '#AA7A47', anchor='middle')
text(2120, 993, '确认后继续工作', 25, '#B38D62', anchor='middle')

# Edge labels: no status line is used as a substitute for the final artifact.
label(1200, 501, '需求与约束', 'blue', 180)
label(1625, 408, '事件 + 实际产物', 'blue', 260)
label(1687, 492, '按授权协调', 'purple', 175, 25)
text(514, 549, '责任', 24, '#94A1B0', anchor='middle')
text(1180, 805, '依赖产物', 25, '#428E76', anchor='middle')
label(2119, 618, '缺关键信息 / 待审批', 'orange', 300, 26)
label(1646, 1068, '补充 / 决定', 'orange', 180, 25)
label(839, 1190, '记录变化与交付', 'purple', 230, 26)
label(1610, 1190, '复用有效上下文', 'purple', 230, 26)
label(2086, 1304, '整体状态与证据', 'purple', 240, 25)

# Footer and colour key.
text(1200, 1523, '需求驱动协作，事件与产物回传，成果交付创造者', 36, '#344B69', 500, 'middle')
for x, color, content in [(650, 'blue', '需求与交付'), (970, 'green', '节点依赖'), (1270, 'purple', '上下文复用'), (1610, 'orange', '人工介入')]:
    parts.append(f'<circle cx="{x}" cy="1592" r="8" fill="{COLORS[color]}"/>')
    text(x+24, 1602, content, 25, '#7C8BA0')
parts.append('</svg>')
(ROOT / 'product-concept.svg').write_text('\n'.join(parts), encoding='utf-8')
print(ROOT / 'product-concept.svg')
