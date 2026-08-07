/** Thrown when a run is cancelled via AbortSignal. */
export class RunCancelledError extends Error {
  readonly name = "RunCancelledError";

  constructor(message = "Run cancelled") {
    super(message);
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RunCancelledError();
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof RunCancelledError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "Run cancelled")
  ) {
    return true;
  }
  return false;
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RunCancelledError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new RunCancelledError());
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
