// ============================================================================
// application · GlobalAgent（全局 Agent：全局观察者）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §7（全局 Agent 与根节点）
//   全局 Agent 观察一切：订阅账本，一切碎片留痕（观察/记账）；
//   只提醒不干预：统计时间、按策略评估提醒，绝不直接干预树；
//   提醒 = 一条 TimeoutAlarm 碎片（账本事实），toId 指向根节点。
//   （注：设计推导中的「苍天/上帝」仅为隐喻，产品与实现统一称「全局 Agent」。）
// ============================================================================

import { Tree } from '../domain/tree.ts';
import { Ledger } from '../domain/ledger.ts';
import type { MessageFragment } from '../domain/fragment.ts';
import { NodeId, NodeStatus, FragmentKind } from '../domain/values.ts';
import type { Alarm, AlarmPolicy } from '../domain/ports.ts';

/** 单个节点的时间统计（由碎片派生，无独立机制） */
export interface TimeStat {
  nodeId: NodeId;
  name: string;
  status: NodeStatus;
  receivedInputAt: number | null;
  lastActivityAt: number | null;
  /** 当前等待时长（ms）；非等待态为 null */
  waitMs: number | null;
}

export class GlobalAgent {
  /** 全局 Agent 的身份（设计决策 F：根节点的父节点；结构挂接随树内核后续展开） */
  readonly id: NodeId;

  private readonly tree: Tree;
  private readonly ledger: Ledger;
  private readonly policies: readonly AlarmPolicy[];
  private readonly lastSeen = new Map<string, number>();
  private readonly inputAt = new Map<string, number>();
  private readonly alarmListeners = new Set<(alarm: Alarm) => void>();
  private readonly unsubscribe: () => void;

  constructor(id: NodeId, tree: Tree, ledger: Ledger, policies: readonly AlarmPolicy[] = []) {
    this.id = id;
    this.tree = tree;
    this.ledger = ledger;
    this.policies = policies;
    // Observer：订阅账本，观察一切新碎片（load 恢复的历史不触发订阅回调）
    this.unsubscribe = ledger.subscribe((fragment) => this.onFragmentAppended(fragment));
    // 历史追平：恢复后订阅的是空账本视图，需要补记全部既有碎片（账本 = 唯一真相源）
    for (const fragment of ledger.fragments()) this.onFragmentAppended(fragment);
  }

  /** 停止观察（生命周期管理） */
  detach(): void {
    this.unsubscribe();
  }

  /** 订阅提醒（Observer）：组合根把提醒转发到通知渠道（待办/钉钉） */
  onAlarm(listener: (alarm: Alarm) => void): () => void {
    this.alarmListeners.add(listener);
    return () => {
      this.alarmListeners.delete(listener);
    };
  }

  // ------------------------------------------------------------------ 观察
  private onFragmentAppended(fragment: MessageFragment): void {
    this.lastSeen.set(fragment.fromId.value, fragment.timestamp);
    this.lastSeen.set(fragment.toId.value, fragment.timestamp);
    if (fragment.kind === FragmentKind.GiveInput) {
      this.inputAt.set(fragment.toId.value, fragment.timestamp);
    }
  }

  /** 时间统计：谁收到过输入、最近活跃于何时、此刻在等多久 */
  timeStats(now: number = Date.now()): TimeStat[] {
    return this.tree.allNodes().map((node) => {
      const lastActivityAt = this.lastSeen.get(node.id.value) ?? null;
      const waiting = node.currentStatus === NodeStatus.Waiting;
      return {
        nodeId: node.id,
        name: node.name,
        status: node.currentStatus,
        receivedInputAt: this.inputAt.get(node.id.value) ?? null,
        lastActivityAt,
        waitMs: waiting && lastActivityAt !== null ? now - lastActivityAt : null,
      };
    });
  }

  // ------------------------------------------------------------------ 提醒
  /** 评估提醒（根节点除外），提醒以碎片入账、送达根节点，并通知订阅者 */
  check(now: number = Date.now()): Alarm[] {
    const alarms: Alarm[] = [];
    for (const node of this.tree.allNodes()) {
      if (node.isSelf) continue; // 根节点提出目标，不受等待提醒约束
      const ctx = {
        nodeId: node.id,
        status: node.currentStatus,
        inputReceivedAt: this.inputAt.get(node.id.value) ?? null,
        lastActivityAt: this.lastSeen.get(node.id.value) ?? null,
        now,
      };
      for (const policy of this.policies) {
        const alarm = policy.evaluate(ctx);
        if (!alarm) continue;
        alarms.push(alarm);
        // 提醒 = 账本事实：只记录、只送达，绝不干预树
        this.ledger.seal({
          kind: FragmentKind.TimeoutAlarm,
          fromId: this.id,
          toId: this.tree.root.id,
          payload: { ...alarm, nodeId: alarm.nodeId.value },
        });
        // 通知触达：订阅者（组合根）转发到待办/钉钉等渠道
        for (const listener of this.alarmListeners) listener(alarm);
      }
    }
    return alarms;
  }
}
