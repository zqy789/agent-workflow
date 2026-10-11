"""UML/流程图构建与提取（stdlib only）。

用法：
  python render-diagrams.py build-html   # 用 CDN mermaid 打包所有 .mmd 为 _diagrams.html
  python render-diagrams.py extract dom  # 从无头浏览器 dump-dom 结果中提取各图 SVG
渲染流程：
  1) build-html → _diagrams.html
  2) msedge --headless --dump-dom _diagrams.html > _dom.html
  3) extract _dom.html → docs/diagrams/*.svg（宽高归一为 viewBox 尺寸）
  4) 每个 svg 用无头浏览器截图成 png
"""
import re
import sys
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = [
    'uml-class.mmd',
    'uml-sequence-flow.mmd',
    'flow-run.mmd',
    'flow-message.mmd',
    'flow-god.mmd',
    'flow-return.mmd',
]
CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'


def build_html() -> None:
    blocks = []
    for name in FILES:
        src = (HERE / name).read_text(encoding='utf-8').strip()
        blocks.append(
            f'<pre class="mermaid" data-name="{name}" style="margin:24px 0;background:#fff;">{escape(src)}</pre>'
        )
    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>diagrams</title>
<script src="{CDN}"></script>
<style>body{{margin:0;padding:24px;background:#fff;font-family:system-ui;}}</style>
<script>
  mermaid.initialize({{ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', flowchart: {{ htmlLabels: true, curve: 'basis' }}, class: {{ htmlLabels: true }}, sequence: {{ mirrorActors: false }} }});
  window.addEventListener('load', async () => {{
    await mermaid.run({{ querySelector: '.mermaid' }});
    document.title = 'RENDERED';
  }});
</script>
</head><body>{''.join(blocks)}</body></html>'''
    out = HERE / '_diagrams.html'
    out.write_text(html, encoding='utf-8')
    print('built:', out)


def extract(dom_path: str) -> None:
    import json
    import math
    dom = Path(dom_path).read_text(encoding='utf-8', errors='replace')
    svgs = re.findall(r'<svg[\s\S]*?</svg>', dom)
    print('svg blocks found:', len(svgs))
    sizes: dict[str, list[int]] = {}
    for name, svg in zip(FILES, svgs):
        # 归一宽高为 viewBox 尺寸，保证截图 1:1
        vb = re.search(r'viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"', svg)
        w = h = 0
        if vb:
            w, h = math.ceil(float(vb.group(3))), math.ceil(float(vb.group(4)))
            svg = re.sub(r'width="[^"]*"', f'width="{w}"', svg, count=1)
            svg = re.sub(r'height="[^"]*"', f'height="{h}"', svg, count=1)
        out = HERE / name.replace('.mmd', '.svg')
        out.write_text(svg, encoding='utf-8')
        sizes[out.stem] = [w, h]
        print('extracted:', out.name, f'{w}x{h}')
    (HERE / '_sizes.json').write_text(json.dumps(sizes, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'extract':
        extract(sys.argv[2])
    else:
        build_html()
