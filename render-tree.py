"""生成式梧桐树渲染器 —— 结构决定树形（mockup 工具，stdlib only）

规则（结构 → 视觉）：
  根（我）= 主干基部；深度决定枝的粗细与高度
  子节点数 = 分叉数；末梢 = 叶位
  状态 → 末梢形态：waiting=花苞(琥珀) / running=新叶(青·脉动) / done=果实(绿·带版本)
  待办数 → 节点旁红果；公有 → 枝头栖凤；账本 → 年轮圈数；全局 Agent → 天光
  树液双线：蓝=I 输送上行 / 绿=O 回流下行
输出：web/tree-<key>.svg（结构不同，树形不同）
"""
import math
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
W, H = 1200, 660
BASE_Y, CROWN_Y, LEVEL_GAP = 552, 402, 130
CX = 600

STATUS = {
    'waiting': ('花苞', '#f0a030'),
    'running': ('新叶', '#35b6f0'),
    'done': ('果实', '#3fbf7f'),
}

TREES = {
    'a': {
        'name': '甲组织',
        'fragments': 128,
        'nodes': [
            # id, name, parent, status, version, pending, public
            ('root', '我', '', 'waiting', 3, 2, False),
            ('lead', '组长', 'root', 'waiting', 2, 0, False),
            ('wood', '木工', 'lead', 'running', 1, 0, False),
            ('paint', '油漆工', 'lead', 'done', 2, 0, False),
            ('senior', '大工', 'lead', 'waiting', 0, 1, False),
            ('junior', '小工', 'senior', 'running', 0, 0, False),
        ],
    },
    'b': {
        'name': '能力库',
        'fragments': 41,
        'nodes': [
            ('root', '我', '', 'waiting', 1, 0, False),
            ('blueprint', '图纸', 'root', 'done', 1, 0, True),
            ('secret', '私藏', 'root', 'waiting', 0, 0, False),
        ],
    },
}

STYLE = '''
.orb-label{font:11px ui-monospace,Consolas,monospace;fill:#8f939c}
.orb-label.strong{fill:#e7eaf3;font-weight:600}
.orb-badge{font:10px ui-monospace,Consolas,monospace;fill:#fff;font-weight:700;text-anchor:middle}
.pulse-orbit{animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.28}50%{opacity:.85}}
'''


def build_positions(nodes):
    by_id = {n[0]: n for n in nodes}
    children = {}
    for n in nodes:
        children.setdefault(n[2], []).append(n[0])
    depth = {}

    def d(nid):
        if nid in depth:
            return depth[nid]
        p = by_id[nid][2]
        depth[nid] = 0 if not p else d(p) + 1
        return depth[nid]
    for n in nodes:
        d(n[0])

    # 叶位槽：末梢先占横向槽位，内部节点取子节点均值
    slots = {}

    def assign(nid):
        if nid in slots:
            return slots[nid]
        kids = children.get(nid, [])
        if not kids:
            slots[nid] = len([k for k in slots if k])  # 简化：按已分配叶数
            return slots[nid]
        xs = [assign(k) for k in kids]
        slots[nid] = sum(xs) / len(xs)
        return slots[nid]
    assign('root')
    leaf_count = len([n for n in nodes if not children.get(n[0])])
    pos = {}
    for n in nodes:
        x = CX + (slots[n[0]] - (leaf_count - 1) / 2) * (170 if leaf_count <= 4 else 150)
        y = BASE_Y if depth[n[0]] == 0 else CROWN_Y - (depth[n[0]] - 1) * LEVEL_GAP
        pos[n[0]] = (x, y)
    return pos, children, depth, leaf_count


def width_for(depth, children, nid):
    kids = children.get(nid, [])
    base = {0: 22, 1: 10, 2: 6}.get(depth, 4)
    return max(base, 4) + (3 if len(kids) >= 3 else 0)


def render(key):
    spec = TREES[key]
    nodes = spec['nodes']
    pos, children, depth, leaf_count = build_positions(nodes)
    by_id = {n[0]: n for n in nodes}
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">']
    parts.append('<style>' + STYLE + '</style>')
    parts.append(f'''<defs>
<radialGradient id="sky" cx="50%" cy="0%" r="90%">
<stop offset="0%" stop-color="#12233a"/><stop offset="55%" stop-color="#070b13"/><stop offset="100%" stop-color="#000000"/>
</radialGradient>
<marker id="arr-up" viewBox="0 0 10 10" refX="5" refY="2" markerWidth="6" markerHeight="6" orient="auto"><path d="M 5 10 L 0 2 L 10 2 Z" fill="#4f8fe8"/></marker>
<marker id="arr-down" viewBox="0 0 10 10" refX="5" refY="8" markerWidth="6" markerHeight="6" orient="auto"><path d="M 5 0 L 0 8 L 10 8 Z" fill="#3fbf7f"/></marker>
</defs>''')
    parts.append(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')

    # 地面 + 年轮（圈数 ∝ log2 碎片数）
    rings = min(6, max(2, int(math.log2(max(2, spec['fragments'])))))
    parts.append(f'<line x1="80" y1="556" x2="1120" y2="556" stroke="rgba(255,255,255,0.08)"/>')
    for i in range(rings):
        parts.append(f'<ellipse cx="{CX}" cy="585" rx="{140 - i*20}" ry="{17 - i*2.2}" fill="none" stroke="rgba(255,255,255,{0.08 + i*0.02})"/>')
    parts.append(f'<text x="{CX}" y="628" text-anchor="middle" class="orb-label">账本 · {spec["fragments"]} 碎片 · 追加式不可篡改</text>')

    # 主干（根 → 树冠起点）
    parts.append(f'<path d="M {CX} {BASE_Y} C {CX} {BASE_Y-80} {CX} {CROWN_Y+70} {CX} {CROWN_Y}" stroke="#3d5a4c" stroke-width="{width_for(0, children, "root")}" stroke-linecap="round" fill="none"/>')

    # 枝（父 → 子）
    for n in nodes:
        nid = n[0]
        if not n[2]:
            continue
        px, py = pos[n[2]]
        if n[2] == 'root':
            px, py = CX, CROWN_Y
        x, y = pos[nid]
        w = width_for(depth[nid], children, nid)
        mx, my = (px + x) / 2, (py + y) / 2
        parts.append(f'<path d="M {px:.1f} {py:.1f} C {px:.1f} {my:.1f} {x:.1f} {my:.1f} {x:.1f} {y:.1f}" stroke="#3d5a4c" stroke-width="{w}" stroke-linecap="round" fill="none"/>')

    # 树液双线（沿主干）
    parts.append(f'<path d="M 616 545 L 616 372" stroke="#4f8fe8" stroke-width="1.6" stroke-dasharray="6 5" fill="none" marker-end="url(#arr-up)"/>')
    parts.append(f'<path d="M 588 372 L 588 545" stroke="#3fbf7f" stroke-width="1.6" stroke-dasharray="6 5" fill="none" marker-end="url(#arr-down)"/>')
    parts.append(f'<text x="638" y="455" class="orb-label">I 输送</text>')
    parts.append(f'<text x="562" y="455" text-anchor="end" class="orb-label">O 回流</text>')

    # 节点标记（末梢形态由状态决定）
    for n in nodes:
        nid, name, parent, status, version, pending, public = n
        x, y = pos[nid]
        if nid == 'root':
            parts.append(f'<circle cx="{x}" cy="{y}" r="20" fill="rgba(255,255,255,0.08)"/>')
            parts.append(f'<circle cx="{x}" cy="{y}" r="12" fill="#ffffff"/>')
            parts.append(f'<text x="{x-26}" y="{y+5}" text-anchor="end" class="orb-label strong">我 · 根节点</text>')
        else:
            label, color = STATUS[status]
            if status == 'running':
                parts.append(f'<circle cx="{x}" cy="{y}" r="16" fill="rgba(53,182,240,0.28)" class="pulse-orbit"/>')
            else:
                parts.append(f'<circle cx="{x}" cy="{y}" r="{16 if status=="waiting" else 14}" fill="{color}" opacity="0.16"/>')
            parts.append(f'<circle cx="{x}" cy="{y}" r="9.5" fill="{color}"/>')
            if status == 'done':
                parts.append(f'<circle cx="{x-3}" cy="{y-3}" r="2.4" fill="rgba(255,255,255,0.4)"/>')
            extra = f' · v{version}' if status == 'done' and version else ''
            parts.append(f'<text x="{x}" y="{y+24}" text-anchor="middle" class="orb-label">{escape(name)} · {label}{escape(extra)}</text>')
            if pending:
                parts.append(f'<circle cx="{x+15}" cy="{y-14}" r="8" fill="#f0554f"/>')
                parts.append(f'<text x="{x+15}" y="{y-10.5}" class="orb-badge">{pending}</text>')
            if public:
                parts.append(f'<path d="M {x-24} {y-16} Q {x-14} {y-26} {x-4} {y-20}" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="1.4" stroke-linecap="round"/>')
                parts.append(f'<text x="{x+22}" y="{y-18}" class="orb-label">凤凰来栖</text>')

    # 全局 Agent：天光
    parts.append('<circle cx="600" cy="78" r="30" fill="none" stroke="rgba(124,140,248,0.5)" stroke-width="1.2"/>')
    parts.append('<circle cx="600" cy="78" r="44" fill="none" stroke="rgba(124,140,248,0.22)" stroke-width="1"/>')
    parts.append('<circle cx="600" cy="78" r="6" fill="#7c8cf8"/>')
    parts.append('<path d="M 600 104 L 600 296" stroke="rgba(124,140,248,0.16)" stroke-width="1" stroke-dasharray="2 6"/>')
    parts.append('<text x="600" y="42" text-anchor="middle" class="orb-label strong">全局 Agent · 只观察 · 不干预</text>')

    # 图例
    legend = [('#4f8fe8', 'I 输送'), ('#3fbf7f', 'O 回流'), ('#f0a030', '等待'), ('#35b6f0', '运行'), ('#3fbf7f', '完成'), ('#f0554f', '提醒')]
    lg = ['<g transform="translate(60,42)">']
    x = 0
    for color, text in legend:
        lg.append(f'<circle cx="{x+6}" cy="3" r="4" fill="{color}"/><text x="{x+16}" y="7" class="orb-label">{text}</text>')
        x += len(text) * 12 + 34
    lg.append('</g>')
    parts.append(''.join(lg))

    # 树名
    parts.append(f'<text x="60" y="620" class="orb-label strong">{escape(spec["name"])} · 梧桐</text>')
    parts.append('</svg>')
    return ''.join(parts)


if __name__ == '__main__':
    for key in TREES:
        out = HERE / 'web' / f'tree-{key}.svg'
        out.write_text(render(key), encoding='utf-8')
        print('written:', out)
