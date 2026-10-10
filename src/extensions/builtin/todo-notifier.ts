// 内置通知实现：Web 待办（PRD FR08 —— 「待办为记录，通知为触达」）
// 消息送达 ≠ 用户已处理；待办是持久记录，通知失败不丢待办。
import type { Notification, Notifier, SendResult } from '../index.ts';

export interface TodoRecord {
  id: string;
  to: string;
  title: string;
  body: string;
  actionUrl?: string;
  sentAt: string;
}

export class TodoNotifier implements Notifier {
  readonly id = 'todo';
  readonly todos: TodoRecord[] = [];
  private seq = 0;

  async send(msg: Notification): Promise<SendResult> {
    this.seq += 1;
    this.todos.push({
      id: `todo-${this.seq}`,
      to: msg.to,
      title: msg.title,
      body: msg.body,
      actionUrl: msg.actionUrl,
      sentAt: new Date().toISOString(),
    });
    return { ok: true, sentAt: new Date().toISOString() };
  }
}
