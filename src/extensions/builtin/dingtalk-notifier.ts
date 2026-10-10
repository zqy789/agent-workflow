// 钉钉通知渠道（FR08「钉钉最小接入」）
// 使用自定义机器人 webhook；webhook 为配置点，未配置时明确失败、不伪造送达。
import type { Notification, Notifier, SendResult } from '../index.ts';

export interface DingTalkNotifierOptions {
  /** 钉钉自定义机器人 webhook 地址 */
  webhook: string;
}

export class DingTalkNotifier implements Notifier {
  readonly id = 'dingtalk';
  readonly configured: boolean;
  private webhook: string;

  constructor(opts: DingTalkNotifierOptions) {
    this.webhook = opts.webhook;
    this.configured = Boolean(this.webhook);
  }

  async send(msg: Notification): Promise<SendResult> {
    const at = new Date().toISOString();
    if (!this.configured) return { ok: false, error: '钉钉 webhook 未配置', sentAt: at };
    try {
      const res = await fetch(this.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            title: (msg.title ?? '通知').slice(0, 24),
            text: `### ${msg.title}\n\n${msg.body}${msg.actionUrl ? `\n\n[去处理](${msg.actionUrl})` : ''}`,
          },
        }),
      });
      const data = (await res.json()) as { errcode?: number; errmsg?: string };
      const ok = res.ok && (data.errcode ?? -1) === 0;
      return { ok, error: ok ? undefined : `钉钉返回 ${data.errcode}: ${data.errmsg}`, sentAt: at };
    } catch (e) {
      // 发送失败明确可见，可重试（FR08）
      return { ok: false, error: e instanceof Error ? e.message : String(e), sentAt: at };
    }
  }
}
