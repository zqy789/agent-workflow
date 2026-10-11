// ============================================================================
// domain · Product（产物 O：不可变、版本化、追加式）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §3.2 守恒律（O 不可篡改）
//   - 传递途中不可篡改：本类无任何 setter，字段全 readonly，修改 = 新实例；
//   - 改自己的产物 = 新版本：nextVersion() 追加新实例，旧版本永存（链上留痕）。
// ============================================================================

import { NodeId } from './values.ts';

export interface ProductOptions {
  id: NodeId;
  producerId: NodeId;
  version: number;
  content: unknown;
  createdAt: string;
  /** 流程内部顺序号（全等汇合按轮次判断用，非业务字段） */
  tick: number;
}

export class Product {
  readonly id: NodeId;
  readonly producerId: NodeId;
  readonly version: number;
  readonly content: unknown;
  readonly createdAt: string;
  readonly tick: number;

  private constructor(opts: ProductOptions) {
    this.id = opts.id;
    this.producerId = opts.producerId;
    this.version = opts.version;
    this.content = opts.content;
    this.createdAt = opts.createdAt;
    this.tick = opts.tick;
  }

  /** 首个版本（v1） */
  static first(
    id: NodeId,
    producerId: NodeId,
    content: unknown,
    createdAt: string,
    tick: number,
  ): Product {
    return new Product({ id, producerId, version: 1, content, createdAt, tick });
  }

  /** 修订 = 新版本：返回新实例，旧实例原样保留（追加式账本语义） */
  nextVersion(id: NodeId, content: unknown, createdAt: string, tick: number): Product {
    return new Product({
      id,
      producerId: this.producerId,
      version: this.version + 1,
      content,
      createdAt,
      tick,
    });
  }

  /** 快照/重放恢复：按落盘字段精确重建（不依赖 first/nextVersion） */
  static restore(
    id: NodeId,
    producerId: NodeId,
    version: number,
    content: unknown,
    createdAt: string,
    tick: number,
  ): Product {
    return new Product({ id, producerId, version, content, createdAt, tick });
  }
}
