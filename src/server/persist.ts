// ============================================================================
// 文件持久化（FR12 真实落地：服务重启不丢状态）
// ----------------------------------------------------------------------------
// 用 JSON 文件保存 Store 快照。生产环境可替换为数据库，接口（load/save）不变。
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StorePlain } from '../engine/store.ts';

export interface FilePersistence {
  load(): StorePlain | null;
  save(plain: StorePlain): void;
}

export function createFilePersistence(filePath: string): FilePersistence {
  return {
    load(): StorePlain | null {
      try {
        if (!existsSync(filePath)) return null;
        return JSON.parse(readFileSync(filePath, 'utf8')) as StorePlain;
      } catch {
        return null;
      }
    },
    save(plain: StorePlain): void {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(plain, null, 2), 'utf8');
    },
  };
}
