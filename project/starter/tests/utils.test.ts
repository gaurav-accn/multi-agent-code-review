import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  withRetry,
  withTimeout,
  ReviewError,
  ErrorCodes,
  formatError,
  isReviewError
} from '../src/utils/error-handler.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('withRetry', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED after all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const error = await withRetry(fn, 3, 1).catch(e => e);
    expect(error).toBeInstanceOf(ReviewError);
    expect(error.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    expect(error.message).toContain('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff between attempts (1x, 2x)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const promise = withRetry(fn, 3, 1000).catch(e => e);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);   // 1000ms + <=100ms jitter
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);   // not yet 2000ms
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600);    // past 2000ms + jitter
    expect(fn).toHaveBeenCalledTimes(3);

    expect((await promise).code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    vi.useRealTimers();
  });

  it('does not retry when shouldRetry returns false', async () => {
    const configError = new ReviewError('bad config', ErrorCodes.INVALID_CONFIG);
    const fn = vi.fn().mockRejectedValue(configError);
    await expect(withRetry(fn, 3, 1, () => false)).rejects.toBe(configError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('returns the result when the function finishes in time', async () => {
    await expect(withTimeout(async () => 42, 1000)).resolves.toBe(42);
  });

  it('rejects with AGENT_TIMEOUT when the function is too slow', async () => {
    const slow = () => new Promise(resolve => setTimeout(() => resolve('late'), 500));
    const error = await withTimeout(slow, 20, 'too slow').catch(e => e);
    expect(error).toBeInstanceOf(ReviewError);
    expect(error.code).toBe(ErrorCodes.AGENT_TIMEOUT);
    expect(error.message).toBe('too slow');
    expect(error.metadata).toEqual({ timeoutMs: 20 });
  });

  it('propagates the original error if the function fails first', async () => {
    await expect(withTimeout(async () => { throw new Error('boom'); }, 1000)).rejects.toThrow('boom');
  });
});

describe('error helpers', () => {
  it('formatError includes the code for ReviewError', () => {
    expect(formatError(new ReviewError('x', ErrorCodes.AGENT_FAILED))).toBe('[AGENT_FAILED] x');
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError('text')).toBe('text');
  });

  it('isReviewError distinguishes ReviewError from Error', () => {
    expect(isReviewError(new ReviewError('x', ErrorCodes.UNKNOWN_ERROR))).toBe(true);
    expect(isReviewError(new Error('x'))).toBe(false);
  });
});

describe('RateLimiter', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('allows requests within limits and tracks them', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 5, maxTokensPerMinute: 10_000, maxConcurrent: 2 });
    expect(limiter.canProceed(1000)).toBe(true);
    await limiter.acquire(1000);
    const status = limiter.getStatus();
    expect(status.activeRequests).toBe(1);
    expect(status.requestsInWindow).toBe(1);
    expect(status.tokensInWindow).toBe(1000);
    limiter.release();
    expect(limiter.getStatus().activeRequests).toBe(0);
  });

  it('blocks when the token budget would be exceeded', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 5000, maxConcurrent: 5 });
    await limiter.acquire(4000);
    limiter.release();
    expect(limiter.canProceed(2000)).toBe(false); // 4000 + 2000 > 5000
    expect(limiter.canProceed(1000)).toBe(true);  // exactly at the limit is allowed
  });

  it('blocks when requests per minute are exhausted', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxTokensPerMinute: 100_000, maxConcurrent: 5 });
    await limiter.acquire(10); limiter.release();
    await limiter.acquire(10); limiter.release();
    expect(limiter.canProceed(10)).toBe(false);
  });

  it('respects maxConcurrent: the 2nd caller waits until release()', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 100, maxTokensPerMinute: 100_000, maxConcurrent: 1 });
    await limiter.acquire(10);

    let secondAcquired = false;
    const second = limiter.acquire(10).then(() => { secondAcquired = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(secondAcquired).toBe(false);

    limiter.release();
    await second;
    expect(secondAcquired).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });

  it('sliding window: old requests fall out after 60 seconds', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxTokensPerMinute: 100_000, maxConcurrent: 5 });
    await limiter.acquire(10);
    limiter.release();
    expect(limiter.canProceed(10)).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(limiter.canProceed(10)).toBe(false);   // still inside the window

    vi.advanceTimersByTime(30_001);
    expect(limiter.canProceed(10)).toBe(true);    // pruned after 60s
    expect(limiter.getStatus().requestsInWindow).toBe(0);
  });

  it('waits for the window to slide before acquiring', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxTokensPerMinute: 100_000, maxConcurrent: 5 });
    await limiter.acquire(10);
    limiter.release();

    let acquired = false;
    const pending = limiter.acquire(10).then(() => { acquired = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(acquired).toBe(false);
    await vi.advanceTimersByTimeAsync(55_000);
    await pending;
    expect(acquired).toBe(true);
  });

  it('release() records actual token usage', async () => {
    const limiter = new RateLimiter();
    await limiter.acquire(1000);
    limiter.release(2500);
    expect(limiter.getStatus().tokensInWindow).toBe(2500);
  });
});