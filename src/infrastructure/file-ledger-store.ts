// ============================================================================
// infrastructure · 文件账本存储（LedgerStore 端口实现）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §11.1（账本 = 独立追加式日志）
//   - 每行一条碎片（JSON），只追加不重写；
//   - 分段：超过 maxSegmentBytes 轮转到新段（ledger-000001.log, …）；
//   - load()：按段序号顺序读取全部碎片（链完整性由 Ledger.load 校验）。
// ============================================================================

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { MessageFragment } from '../domain/fragment.ts';
import { NodeId, type FragmentKind } from '../domain/values.ts';
import type { LedgerStore } from '../domain/ports.ts';

const SEGMENT_RE = /^ledger-(\d{6})\.log$/;
const DEFAULT_MAX_SEGMENT_BYTES = 4 * 1024 * 1024; // 4 MiB

export interface FileLedgerStoreOptions {
  /** 账本日志目录（或单文件路径） */
  path: string;
  maxSegmentBytes?: number;
}

export class FileLedgerStore implements LedgerStore {
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly segments: string[] = []; // 按序号升序的段文件名
  private currentPath: string;
  private currentBytes: number;

  constructor(opts: FileLedgerStoreOptions) {
    this.dir = opts.path;
    this.maxBytes = opts.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    if (statSync(this.dir).isFile()) throw new Error(`账本路径应为目录: ${this.dir}`);

    const existing = readdirSync(this.dir)
      .filter((f) => SEGMENT_RE.test(f))
      .sort();
    this.segments.push(...existing);
    this.currentPath = existing.length
      ? join(this.dir, existing[existing.length - 1])
      : join(this.dir, 'ledger-000001.log');
    this.currentBytes = existsSync(this.currentPath) ? statSync(this.currentPath).size : 0;
  }

  append(fragment: MessageFragment): void {
    const line = this.toLine(fragment);
    const bytes = Buffer.byteLength(line, 'utf8');
    if (this.currentBytes > 0 && this.currentBytes + bytes > this.maxBytes) this.rotate();
    appendFileSync(this.currentPath, line, 'utf8');
    this.currentBytes += bytes;
  }

  load(): MessageFragment[] {
    const out: MessageFragment[] = [];
    for (const seg of this.segments) {
      const text = readFileSync(join(this.dir, seg), 'utf8');
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        const raw = JSON.parse(line) as {
          id: string; prevHash: string; kind: FragmentKind;
          fromId: string; toId: string; payload?: unknown; timestamp: number;
        };
        out.push(MessageFragment.fromPlain({
          id: NodeId.of(raw.id),
          prevHash: raw.prevHash,
          kind: raw.kind,
          fromId: NodeId.of(raw.fromId),
          toId: NodeId.of(raw.toId),
          payload: raw.payload,
          timestamp: raw.timestamp,
        }));
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ 内部
  private rotate(): void {
    const m = SEGMENT_RE.exec(this.currentPath.split(/[\\/]/).pop() ?? '');
    const next = (m ? Number(m[1]) : 0) + 1;
    this.currentPath = join(this.dir, `ledger-${String(next).padStart(6, '0')}.log`);
    this.segments.push(this.currentPath.split(/[\\/]/).pop() ?? '');
    this.currentBytes = 0;
  }

  private toLine(f: MessageFragment): string {
    const plain = {
      id: f.id.value,
      prevHash: f.prevHash,
      kind: f.kind,
      fromId: f.fromId.value,
      toId: f.toId.value,
      payload: f.payload,
      timestamp: f.timestamp,
    };
    return JSON.stringify(plain) + '\n';
  }
}
