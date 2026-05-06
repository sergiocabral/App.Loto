type QueuedLoad<T> = {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
};

export type SequentialLoadQueue<T> = {
  load: (key: string, options?: { priority?: boolean }) => Promise<T>;
};

export function createSequentialLoadQueue<T>(loader: (key: string) => Promise<T>): SequentialLoadQueue<T> {
  const queuedLoads = new Map<string, QueuedLoad<T>>();
  const queue: string[] = [];
  let isRunning = false;

  function moveToFront(key: string): void {
    const currentIndex = queue.indexOf(key);

    if (currentIndex >= 0) {
      queue.splice(currentIndex, 1);
    }

    queue.unshift(key);
  }

  function schedule(): void {
    if (!isRunning) {
      void run();
    }
  }

  async function run(): Promise<void> {
    if (isRunning) {
      return;
    }

    isRunning = true;

    try {
      while (queue.length) {
        const key = queue.shift();

        if (!key) {
          continue;
        }

        const queuedLoad = queuedLoads.get(key);

        if (!queuedLoad) {
          continue;
        }

        try {
          const value = await loader(key);
          queuedLoad.resolve(value);
        } catch (error) {
          queuedLoad.reject(error);
        } finally {
          queuedLoads.delete(key);
        }
      }
    } finally {
      isRunning = false;

      if (queue.length) {
        schedule();
      }
    }
  }

  function load(key: string, options: { priority?: boolean } = {}): Promise<T> {
    const queuedLoad = queuedLoads.get(key);

    if (queuedLoad) {
      if (options.priority) {
        moveToFront(key);
      }

      return queuedLoad.promise;
    }

    let resolveQueuedLoad: QueuedLoad<T>["resolve"] | null = null;
    let rejectQueuedLoad: QueuedLoad<T>["reject"] | null = null;
    const promise = new Promise<T>((resolve, reject) => {
      resolveQueuedLoad = resolve;
      rejectQueuedLoad = reject;
    });

    queuedLoads.set(key, {
      promise,
      reject: (error) => rejectQueuedLoad?.(error),
      resolve: (value) => resolveQueuedLoad?.(value),
    });

    if (options.priority) {
      moveToFront(key);
    } else {
      queue.push(key);
    }

    schedule();
    return promise;
  }

  return { load };
}
