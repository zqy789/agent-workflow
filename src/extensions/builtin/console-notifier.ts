// 内置通知实现：控制台（演示用）
import type { Notification, Notifier, SendResult } from '../index.ts';

export const consoleNotifier: Notifier = {
  id: 'console',
  async send(msg: Notification): Promise<SendResult> {
    console.log(`[通知:${msg.channel}] ${msg.title} → ${msg.to}: ${msg.body}`);
    return { ok: true, sentAt: new Date().toISOString() };
  },
};
