// ============================================================================
// domain · Input（输入 I：自上而下的流经物）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §3.2 守恒律（I 可篡改）
//   - I 由父传给子，内容由给出方决定——每级可加工改写后下传；
//   - 改写痕迹的完整追溯在消息碎片链（步骤③）中记录，本类只承载交付事实。
// ============================================================================

import { NodeId } from './values.ts';

export interface InputOptions {
  content: unknown;
  /** 给出方（必为父节点，FlowService 守护） */
  givenBy: NodeId;
  /** 流程内部顺序号（轮次判断用） */
  tick: number;
}

export class Input {
  readonly content: unknown;
  readonly givenBy: NodeId;
  readonly tick: number;

  constructor(opts: InputOptions) {
    this.content = opts.content;
    this.givenBy = opts.givenBy;
    this.tick = opts.tick;
  }
}
