/**
 * Bounded-concurrency runner.
 *
 * Worker errors propagate (caller is expected to wrap with try/catch or
 * `retryAsync`).  Results are returned in input order.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

export interface RetryOptions {
  /** Number of retry attempts after the initial call (so totalCalls = retries + 1). */
  retries: number;
  /** Base delay in ms between retries, doubled on each subsequent attempt. */
  initialDelayMs?: number;
  /** Cap for the exponential backoff delay. */
  maxDelayMs?: number;
  /**
   * Predicate to decide whether a thrown error is retriable.
   * Returning false short-circuits and rethrows immediately.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Optional sleep injection (used by tests to avoid real timers). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run an async operation, retrying on failure with exponential backoff.
 *
 * Throws the last error after exhausting retries.  Use `shouldRetry` to bail
 * out early on non-retriable errors (e.g. rate-limit responses where we want
 * to surface the error to the user immediately).
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    retries,
    initialDelayMs = 250,
    maxDelayMs = 4_000,
    shouldRetry,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      if (shouldRetry && !shouldRetry(error, attempt)) break;

      const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}
