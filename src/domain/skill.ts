// ============================================================================
// domain · Skill（Agent 能力的部件，本质是 MD 文件）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §1 三大对象（SKILL）
//   - 与节点是组合关系：组合进节点的能力，随节点存亡，不独立流转；
//   - 不可变：内容为 MD 原文，只读。
// ============================================================================

export interface SkillOptions {
  id: string;
  /** MD 文件原文 */
  content: string;
}

export class Skill {
  readonly id: string;
  readonly content: string;

  constructor(opts: SkillOptions) {
    if (!opts.id || opts.id.trim() === '') throw new Error('Skill id 不能为空');
    if (!opts.content || opts.content.trim() === '') throw new Error('Skill 内容不能为空');
    this.id = opts.id;
    this.content = opts.content;
  }
}
