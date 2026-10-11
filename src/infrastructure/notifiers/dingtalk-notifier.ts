// ============================================================================
// infrastructure · 钉钉通知渠道（NotifierChannel 端口实现）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §6（渠道触达：Web 待办 / 钉钉）
//   - webhook 为配置点；未配置时明确失败、不伪造送达；
//   - 待办为记录、通知为触达：发送失败可见、可重试，不丢待办。
// ============================================================================

import type { Notice, NotifierChannel, SendResult } from '../../domain/ports.ts';

export interface DingTalkNotifierOptions {
  /** 钉钉自定义机器人 webhook */
  webhook: string;
}

export class DingTalkNotifier implements NotifierChannel {
  readonly id = 'dingtalk';
  readonly configured: boolean;
  private readonly webhook: string;

  constructor(opts: DingTalkNotifierOptions) {
    this.webhook = opts.webhook;
    this.configured = Boolean(opts.webhook);
  }

  async send(notice: Notice): Promise<SendResult> {
    const sentAt = new Date().toISOString();
    if (!this.configured) return { ok: false, sentAt, error: '钉钉 webhook 未配置' };
    try {
      const res = await fetch(this.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            title: (notice.title ?? '通知').slice(0, 24),
            text: `### ${notice.title}\n\n${notice.body}${notice.actionUrl ? `\n\n[去处理](${notice.actionUrl})` : ''}`,
          },
        }),
      });
      const data = (await res.json()) as { errcode?: number; errmsg?: string };
      const sent = res.ok && (data.errcode ?? -1) === 0;
      return {
        ok: sent,
        sentAt,
        error: sent ? undefined : `钉钉返回 ${data.errcode}: ${data.errmsg}`,
      };
    } catch (e) {
      // 发送失败明确可见、可重试（FR08：不丢待办）
      return { ok: false, sentAt, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
