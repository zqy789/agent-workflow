// ============================================================================
// infrastructure · SKILL 加载器（MD 文件 → Skill 值对象）
// ----------------------------------------------------------------------------
// SKILL 是 Agent 的伴生能力（MD 文件）；加载器把目录里的 .md 读为 Skill。
// ============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Skill } from '../domain/skill.ts';

export class SkillLoader {
  /** 加载目录下所有 .md（id = 文件名去扩展名） */
  load(dir: string): Skill[] {
    const out: Skill[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const full = join(dir, name);
      if (!statSync(full).isFile()) continue;
      out.push(new Skill({
        id: name.slice(0, -'.md'.length),
        content: readFileSync(full, 'utf8'),
      }));
    }
    return out;
  }
}
