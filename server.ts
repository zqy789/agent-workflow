// ============================================================================
// 服务端入口：`node server.ts`
// 数据目录结构（设计 §11.1 两份存储）：
//   data/ledger/      账本（只追加日志 + 分段，链式哈希）
//   data/forest.json  树快照（可变状态整写）
// ============================================================================

import { createApp } from './src/interfaces/http/app.ts';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? 'data';
const { server } = createApp({ dataDir });

server.listen(port, () => {
  console.log(`[agent-workflow v0.2] listening on http://localhost:${port}`);
  console.log(`[agent-workflow v0.2] data dir: ${dataDir}`);
});
