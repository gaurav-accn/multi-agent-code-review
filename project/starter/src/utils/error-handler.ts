/**
 * Custom error class for review operations
 */
export class ReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReviewError';
    Error.captureStackTrace(this, ReviewError);
  }
}

/**
 * Error codes for the review system
 */
export const ErrorCodes = {
  // Configuration errors
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',

  // GitHub errors
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Agent errors
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',

  // General errors
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/** Promise-based sleep helper */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry utility with exponential backoff
 *
 * Algorithm:
 * 1. Try to execute the function
 * 2. If it succeeds, return the result
 * 3. If it fails and attempts remain:
 *    - Calculate backoff delay: delayMs * 2^(attempt - 1)
 *    - Add jitter (random 0-100ms) to prevent thundering herd
 *    - Wait for the calculated duration
 *    - Retry
 * 4. If all attempts are exhausted, throw ReviewError with RETRY_EXHAUSTED code
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of attempts, including the first (default: 3)
 * @param delayMs - Base delay in milliseconds (default: 1000)
 * @param shouldRetry - Optional predicate; return false for non-transient errors
 *                      (e.g. bad configuration) to fail fast without retrying
 * @returns The result of the successful function execution
 * @throws ReviewError with RETRY_EXHAUSTED code if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
  shouldRetry: (error: unknown) => boolean = () => true
): Promise<T> {
  const attempts = Math.max(1, Math.floor(maxRetries));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error)) throw error;
      if (attempt === attempts) break;

      // Exponential backoff (1x, 2x, 4x, ...) plus 0-100ms jitter so that
      // many clients retrying at once don't hit the API in lock-step.
      const backoff = delayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 100;
      await sleep(backoff + jitter);
    }
  }

  throw new ReviewError(
    `Operation failed after ${attempts} attempt(s): ${formatError(lastError)}`,
    ErrorCodes.RETRY_EXHAUSTED,
    { attempts, lastError: formatError(lastError) }
  );
}

/**
 * Wrap an async function with timeout
 * Races the provided function against a timeout; whichever completes first wins.
 *
 * @param fn - Async function to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message
 * @returns The result of the function if it completes before timeout
 * @throws ReviewError with AGENT_TIMEOUT code if timeout is reached
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ReviewError(errorMessage, ErrorCodes.AGENT_TIMEOUT, { timeoutMs })),
      timeoutMs
    );
  });

  try {
    // Whichever settles first wins
    return await Promise.race([fn(), timeout]);
  } finally {
    // Always clear the timer so it doesn't keep the process alive
    if (timer) clearTimeout(timer);
  }
}

/**
 * Check if an error is a ReviewError
 */
export function isReviewError(error: unknown): error is ReviewError {
  return error instanceof ReviewError;
}

/**
 * Format error for logging/display
 */
export function formatError(error: unknown): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}