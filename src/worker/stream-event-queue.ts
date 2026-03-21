interface StreamWaiter<TEvent> {
  match: (event: TEvent) => boolean;
  resolve: (event: TEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class StreamEventQueue<TEvent> {
  private readonly buffer: TEvent[] = [];
  private readonly waiters: StreamWaiter<TEvent>[] = [];

  public constructor(
    private readonly timeoutMs: number,
    private readonly timeoutMessage = `timed out waiting for worker stream event (${timeoutMs}ms)`,
  ) {}

  public push(event: TEvent): void {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.match(event));
    if (waiterIndex >= 0) {
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      if (!waiter) {
        this.buffer.push(event);
        return;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(event);
      return;
    }

    this.buffer.push(event);
  }

  public waitFor(match: (event: TEvent) => boolean): Promise<TEvent> {
    const bufferedIndex = this.buffer.findIndex(match);
    if (bufferedIndex >= 0) {
      const [event] = this.buffer.splice(bufferedIndex, 1);
      if (event) {
        return Promise.resolve(event);
      }
    }

    return new Promise<TEvent>((resolve, reject) => {
      const waiter: StreamWaiter<TEvent> = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new Error(this.timeoutMessage));
        }, this.timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  public failAll(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private removeWaiter(target: StreamWaiter<TEvent>): void {
    const index = this.waiters.indexOf(target);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }
}
