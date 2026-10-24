/** 简单信号量（7.3）：限制并发 fan-out 数（= Workers 免费版同时出站连接上限 6） */
export class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
