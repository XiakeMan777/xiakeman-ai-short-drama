// ============================================================
// PERF4: 并发限制器
// 限制同时执行的 Promise 数量，用于 IndexedDB loadBlob 并发控制
// ============================================================

export class ConcurrentLimiter {
  private running = 0;
  private queue: (() => void)[] = [];
  private maxConcurrency: number;

  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  /** 包装一个异步函数，自动排队执行 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
