// ============================================================================
// infrastructure · 森林快照存储（TreeStore 端口实现）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §11.1（树快照 = 可变状态的性能缓存）
// 快照 JSON = { ledgerTail: <保存时的账本尾哈希>, trees: TreePlain[] }。
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { TreeStore } from '../domain/ports.ts';

export class ForestStoreFile implements TreeStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  save(snapshot: string): void {
    writeFileSync(this.path, snapshot, 'utf8');
  }

  load(): string | null {
    return existsSync(this.path) ? readFileSync(this.path, 'utf8') : null;
  }
}
