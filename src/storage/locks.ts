export class InProcessLock {
  queue: Promise<void>;

  constructor() {
    this.queue = Promise.resolve();
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;

    this.queue = new Promise((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }
}

