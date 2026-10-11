"""Rebuild the editable SVG concept diagram for v0.2 (tree / flow / ledger); stdlib only."""
from pathlib import Path
from html import escape

ROOT = Path(__file__).resolve().parent
parts = ['''<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1680" viewBox="0 0 2400 1680" role="img" aria-labelledby="title desc">
<title id="title">Agent WorkFlow：树 · 流 · 账本 概念图</title>
<desc id="desc">苍天（上帝）在树顶观察一切、记账、统计时间、只示警不干预。根（皇帝）提出目标、监听上行消息、改写为新 I。I 输入自上而下可篡改，O 产物自下而上不可篡改并逐级验收（通过/跳过/打回）。一切相邻交易生成消息碎片，串成全局单链账本。</desc>
<defs>
  <marker id="blue" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#376BC5"/></marker>
  <marker id="green" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#428E76"/></marker>
  <marker id="orange" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#CC873C"/></marker>
  <marker id="purple" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#9273AE"/></marker>
  <marker id="red" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#C0563F"/></marker>
</defs>
<rect width="2400" height="1680" fill="#F7F9FC"/>
''']
COLORS = {'blue': '#376BC5', 'green': '#428E76', 'orange': '#CC873C', 'purple': '#9273AE', 'red': '#C0563F', 'gray': '#A2ACB8', 'gold': '#B98A2F'}


def rect(x, y, w, h, fill, stroke, r=24):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')


def text(x, y, content, size=30, fill='#26364B', weight=400, anchor='start'):
    parts.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{fill}" font-family="Hiragino Sans GB, Arial, sans-serif" font-size="{size}" font-weight="{weight}">{escape(content)}</text>')


def arrow(path, color, width=4, dashed=False):
    dash = ' stroke-dasharray="10 10"' if dashed else ''
    parts.append(f'<path d="{path}" fill="none" stroke="{COLORS[color]}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"{dash} marker-end="url(#{color})"/>')


def line(path, color, width=3):
    parts.append(f'<path d="{path}" fill="none" stroke="{COLORS[color]}" stroke-width="{width}" stroke-linecap="round"/>')


def elabel(x, y, content, color, width, size=24):
    parts.append(f'<rect x="{x-width/2}" y="{y-size-4}" width="{width}" height="{size+14}" rx="9" fill="#F7F9FC"/>')
    text(x, y, content, size, COLORS[color], 500, 'middle')


def dot(x, y, color, r=9):
    fill = color if color.startswith('#') else COLORS[color]
    parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')


# ------------------------------------------------------------------ header
text(100, 78, 'AGENT WORKFLOW / V0.2 · 第一性原理概念图', 25, '#70809A', 600)
text(100, 168, '一棵树 · 一条链 · 一个流', 64, '#182B48', 600)
text(103, 221, '一切皆节点 · 相邻才交易 · 流即 IO · I 可变 O 不变 · 苍天有眼、天子执政', 29, '#697B92')

# ------------------------------------------------------------------ 苍天（上帝）
rect(640, 290, 1120, 128, '#F1EBFA', '#B9A3DF', 28)
text(1200, 348, '苍天 · 上帝（全局 Agent）', 40, '#5B3E96', 600, 'middle')
text(1200, 392, '观察一切 · 记账 · 统计时间 · 只示警不干预', 27, '#7A63A8', anchor='middle')

# ------------------------------------------------------------------ 根（皇帝）
rect(940, 505, 520, 140, '#FBF3E0', '#D8B877', 24)
text(1200, 560, '根节点 · 皇帝（天子）', 38, '#7A5B1E', 600, 'middle')
text(1200, 602, '提出目标（木头 → 椅子）· 唯一监听者', 26, '#8F7440', anchor='middle')
text(1200, 634, '改写消息为新 I · 剪枝解死锁', 26, '#8F7440', anchor='middle')

# ------------------------------------------------------------------ 账本面板
rect(1880, 500, 330, 750, '#FFFDF6', '#E4D8BC', 24)
text(2045, 545, '全局单链账本', 32, '#7A5B1E', 600, 'middle')
text(2045, 574, '只追加 · prevHash · 不可篡改', 21, '#A08C5A', anchor='middle')
for i, y in enumerate([640, 720, 800, 880, 960, 1040, 1120], start=1):
    rect(1900, y, 290, 62, '#FFFFFF', '#D9CBAC', 12)
    text(2045, y + 30, f'碎片 #{i}', 23, '#26364B', 500, 'middle')
    text(2045, y + 49, 'prevHash · 相邻交易', 18, '#70809A', anchor='middle')
    if i > 1:
        line(f'M 2045 {y - 18} L 2045 {y}', 'orange', 3)

# ------------------------------------------------------------------ 边（先画，卡牌后盖）
arrow('M 1200 418 L 1200 505', 'purple', 4)
arrow('M 1030 645 L 840 770', 'blue', 4)            # 根→A
arrow('M 1200 645 L 1250 770', 'blue', 4)           # 根→B
arrow('M 1370 645 L 1660 770', 'blue', 4)           # 根→C
arrow('M 820 890 L 700 1060', 'blue', 4)            # A→A1
arrow('M 860 890 L 1100 1060', 'blue', 4)           # A→A2
arrow('M 740 1060 L 860 890', 'green', 4)           # A1→A（O）
arrow('M 1060 1060 L 820 890', 'green', 4)          # A2→A（O）
arrow('M 1660 770 L 1330 645', 'green', 4)          # C→根（O）
arrow('M 1250 770 L 1210 645', 'orange', 4)         # B→根（消息上行）
arrow('M 1460 570 L 1892 570', 'orange', 4)         # 根→账本（相邻交易=碎片）
arrow('M 2212 640 L 2212 354 L 1762 354', 'orange', 4)  # 账本→苍天

elabel(1330, 462, '示警反馈 · 父子相邻', 'purple', 300)
elabel(930, 692, 'I 输入 · 可改写', 'blue', 240)
elabel(748, 972, '通过', 'green', 90)
elabel(975, 972, '跳过', 'green', 90)
elabel(1510, 702, '通过', 'green', 90)
elabel(1285, 712, '消息上行', 'orange', 150)
elabel(1675, 548, '相邻交易 = 碎片', 'orange', 250)
elabel(1985, 330, '账本归上帝', 'orange', 200)

# ------------------------------------------------------------------ 树：第一层
rect(650, 770, 380, 120, '#FBF1DF', '#D9B36A', 22)
dot(692, 800, '#C08A3E')
text(790, 812, '节点 A · 等待', 34, '#6E4F1B', 600, 'middle')
text(840, 852, '等 A1 + A2 全部回流（全等汇合）', 24, '#8F7440', anchor='middle')

rect(1060, 770, 380, 120, '#E5F4F6', '#7FB8C2', 22)
dot(1102, 800, '#3E97A8')
text(1200, 812, '节点 B · 运行', 34, '#2E6E7A', 600, 'middle')
text(1250, 852, 'Agent / CI-CD / …', 24, '#5B8C96', anchor='middle')

rect(1470, 770, 380, 120, '#E8F2EC', '#8FBFA6', 22)
dot(1512, 800, '#3F8A63')
text(1608, 812, '节点 C · 完成', 34, '#2F6B4F', 600, 'middle')
text(1660, 852, '产物已通过验收', 24, '#5B8C70', anchor='middle')

# ------------------------------------------------------------------ 树：第二层（A 的分支）
rect(570, 1060, 300, 110, '#E8F2EC', '#8FBFA6', 22)
dot(610, 1090, '#3F8A63')
text(670, 1108, '节点 A1 · 完成', 30, '#2F6B4F', 600, 'middle')

rect(930, 1060, 300, 110, '#E8F2EC', '#8FBFA6', 22)
dot(970, 1090, '#3F8A63')
text(1030, 1108, '节点 A2 · 完成', 30, '#2F6B4F', 600, 'middle')

# ------------------------------------------------------------------ 左栏：流 / 对象 / 状态
rect(95, 480, 370, 360, '#FBFCFE', '#D8E2EB', 24)
text(115, 540, '流 · IO', 32, '#253952', 600)
arrow('M 150 665 L 150 585', 'blue', 5)
text(190, 615, 'I 输入', 27, '#254C8B', 600)
text(190, 642, '可篡改 · 每级可加工', 22, '#57739D')
arrow('M 150 790 L 150 710', 'green', 5)
text(190, 740, 'O 产物', 27, '#2F6B4F', 600)
text(190, 767, '不可篡改 · 版本化', 22, '#5B8C70')
arrow('M 150 825 L 235 825', 'red', 4, True)
text(255, 831, '打回 · 沿路退回下游', 22, '#C0563F')

rect(95, 870, 370, 310, '#FBFCFE', '#D8E2EB', 24)
text(115, 930, '三大对象', 32, '#253952', 600)
text(115, 972, '节点', 26, '#26364B', 600)
text(135, 1002, '一切能力的载体', 22, '#66788E')
text(115, 1042, '通知', 26, '#26364B', 600)
text(135, 1072, '消息机制 · 产物 = 碎片', 22, '#66788E')
text(115, 1112, 'SKILL', 26, '#26364B', 600)
text(135, 1142, 'MD 文件 · 组合进节点', 22, '#66788E')

rect(95, 1210, 370, 200, '#FBFCFE', '#D8E2EB', 24)
text(115, 1270, '三态 · 状态只回答「在干什么」', 27, '#253952', 600)
dot(128, 1315, '#C08A3E')
text(150, 1323, '等待 · 原因在链上', 23, '#8F7440')
dot(128, 1350, '#3E97A8')
text(150, 1358, '运行 · 动着', 23, '#3E7E8A')
dot(128, 1385, '#3F8A63')
text(150, 1393, '完成 · 干完', 23, '#3F6F58')

# ------------------------------------------------------------------ 底部：公理 + 图例
text(1200, 1500, '一切皆节点；相邻才交易；流即 IO；I 可变 O 不变；碎片成链；苍天有眼、天子执政', 30, '#182B48', 600, 'middle')
legend = [('blue', 'I 输入'), ('green', 'O 产物'), ('orange', '消息 / 账本'), ('purple', '苍天 · 上帝'), ('gold', '皇帝 · 根'), ('red', '打回')]
for i, (c, t) in enumerate(legend):
    x = 560 + i * 210
    parts.append(f'<rect x="{x}" y="1547" width="18" height="18" rx="5" fill="{COLORS[c]}"/>')
    text(x + 28, 1562, t, 25, '#4A5871')
text(1200, 1620, '概念图 · 不表达具体界面布局 · 用于对齐设计语义', 22, '#A2ACB8', anchor='middle')

parts.append('</svg>')
(ROOT / 'product-concept-v02.svg').write_text(''.join(parts), encoding='utf-8')
print('written:', ROOT / 'product-concept-v02.svg')
