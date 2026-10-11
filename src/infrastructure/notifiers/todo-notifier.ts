// ============================================================================
// infrastructure · 待办通知渠道（「待办为记录，通知为触达」）
// ----------------------------------------------------------------------------
// 消息送达 ≠ 已处理：待办是持久记录；渠道发送失败不丢待办、不阻断业务。
// ============================================================================

import type { Notice, NotifierChannel, SendResult } from '../../domain/ports.ts';

export interface TodoRecord {
  id: string;
  to: string;
  title: string;
  body: string;
  actionUrl?: string;
  sentAt: string;
}

export class TodoNotifier implements NotifierChannel {
  readonly id = 'todo';
  readonly todos: TodoRecord[] = [];
  private seq = 0;

  async send(notice: Notice): Promise<SendResult> {
    this.seq += 1;
    const sentAt = new Date().toISOString();
    this.todos.push({
      id: `todo-${this.seq}`,
      to: notice.to,
      title: notice.title,
      body: notice.body,
      actionUrl: notice.actionUrl,
      sentAt,
    });
    return { ok: true, sentAt };
  }
}
