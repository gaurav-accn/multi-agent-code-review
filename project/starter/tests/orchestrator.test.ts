import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  CodeReviewOrchestrator,
  Orchestrator,
  computeSummary,
  finalizeReport,
  ORCHESTRATOR_ALLOWED_TOOLS
} from '../src/orchestrator.js';
import type { QueryFn } from '../src/orchestrator.js';
import { ReviewReportSchema } from '../src/types/index.js';
import { ErrorCodes, ReviewError } from '../src/utils/error-handler.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { logger } from '../src/utils/logger.js';
import { validReport } from './fixtures.js';

/**
 * Tests for CodeReviewOrchestrator
 * The SDK query function is injected, so no API key or network is needed.
 */

const AGENTS = ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester'];

const initMessage = (githubStatus = 'connected') => ({
  type: 'system',
  subtype: 'init',
  model: 'test-model',
  agents: AGENTS,
  skills: ['javascript-best-practices', 'security-analysis', 'typescript-patterns'],
  tools: [],
  mcp_servers: [{ name: 'github', status: githubStatus }, { name: 'eslint', status: 'connected' }]
});

const assistantToolUse = (blocks: Array<{ id: string; name: string; input: Record<string, unknown> }>, parent: string | null = null) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { content: blocks.map(b => ({ type: 'tool_use', ...b })) }
});

const successResult = (structured_output: unknown) => ({
  type: 'result',
  subtype: 'success',
  num_turns: 7,
  total_cost_usd: 0.5,
  usage: { input_tokens: 1000, output_tokens: 500 },
  structured_output
});

/** Build a fake SDK query that yields the given messages and records its arguments */
function fakeQuery(messages: unknown[]) {
  const calls: Array<Parameters<QueryFn>[0]> = [];
  const fn: QueryFn = (params) => {
    calls.push(params);
    return (async function* () {
      for (const m of messages) yield m as SDKMessage;
    })();
  };
  return { fn, calls };
}

const happyPathMessages = () => [
  initMessage(),
  assistantToolUse([
    { id: 'gh1', name: 'mcp__github__get_pull_request', input: { owner: 'udacity', repo: 'r', pull_number: 2 } },
    { id: 'gh2', name: 'mcp__github__get_pull_request_files', input: {} }
  ]),
  assistantToolUse(AGENTS.map((a, i) => ({ id: `task${i}`, name: 'Task', input: { subagent_type: a, description: a } }))),
  assistantToolUse([{ id: 's1', name: 'Skill', input: { skill: 'security-analysis' } }], 'task0'),
  successResult(validReport)
];

const newOrchestrator = (queryFn: QueryFn, extra: Record<string, unknown> = {}) =>
  new CodeReviewOrchestrator({
    model: 'test-model',
    projectRoot: process.cwd(),
    queryFn,
    maxRetries: 1,
    retryDelayMs: 1,
    timeoutMs: 5_000,
    ...extra
  });

describe('CodeReviewOrchestrator', () => {
  // Keep test output readable
  beforeAll(() => { logger.silent = true; });
  afterAll(() => { logger.silent = false; });

  /** withRetry wraps the final failure in RETRY_EXHAUSTED; the original code is kept in the message */
  const expectFailure = (error: unknown, code: string) => {
    expect(error).toBeInstanceOf(ReviewError);
    expect((error as ReviewError).code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    expect((error as ReviewError).message).toContain(`[${code}]`);
  };

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator({ model: 'test-model' });
      expect(orchestrator.model).toBe('test-model');
      expect(orchestrator.maxTurns).toBeGreaterThanOrEqual(20);
      expect(orchestrator.rateLimiter).toBeInstanceOf(RateLimiter);
    });

    it('reads the model from ANTHROPIC_MODEL (not hardcoded)', () => {
      const previous = process.env.ANTHROPIC_MODEL;
      process.env.ANTHROPIC_MODEL = 'model-from-env';
      expect(new CodeReviewOrchestrator().model).toBe('model-from-env');
      delete process.env.ANTHROPIC_MODEL;
      expect(() => new CodeReviewOrchestrator()).toThrow(ReviewError);
      if (previous !== undefined) process.env.ANTHROPIC_MODEL = previous;
    });

    it('should accept custom rate limit configuration', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        model: 'test-model',
        rateLimits: { maxRequestsPerMinute: 1, maxTokensPerMinute: 60_000, maxConcurrent: 1 }
      });
      await orchestrator.rateLimiter.acquire(50_000);
      expect(orchestrator.rateLimiter.canProceed(20_000)).toBe(false);
      orchestrator.rateLimiter.release();
    });

    it('configures the SDK with Task tool, MCP servers, 3 agents and structured output', () => {
      const options = newOrchestrator(fakeQuery([]).fn).buildQueryOptions();
      expect(options.allowedTools).toContain('Task');
      expect(options.allowedTools).toContain('mcp__github__get_pull_request');
      expect(Object.keys(options.mcpServers ?? {})).toEqual(expect.arrayContaining(['github', 'eslint']));
      expect(Object.keys(options.agents ?? {})).toEqual(AGENTS);
      for (const agent of Object.values(options.agents ?? {})) {
        expect(agent.model).toBe('inherit');
        expect(agent.tools).toContain('Skill');
        expect(agent.description.length).toBeGreaterThan(40);
      }
      expect(options.outputFormat?.type).toBe('json_schema');
      expect(options.settingSources).toEqual(['project']);
      expect(options.model).toBe('test-model');
      expect(ORCHESTRATOR_ALLOWED_TOOLS).not.toContain('Bash');
    });

    it('exports Orchestrator as an alias', () => {
      expect(Orchestrator).toBe(CodeReviewOrchestrator);
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR data via the GitHub MCP tools named in the prompt', async () => {
      const { fn, calls } = fakeQuery(happyPathMessages());
      await newOrchestrator(fn).reviewPullRequest('udacity', 'cd14715-simple-todo-app', 2);

      expect(calls).toHaveLength(1);
      const prompt = calls[0]!.prompt;
      let text = '';
      for await (const m of prompt as AsyncIterable<{ message: { content: string } }>) text += m.message.content;
      expect(text).toContain('mcp__github__get_pull_request');
      expect(text).toContain('udacity/cd14715-simple-todo-app #2');
    });

    it('should spawn all 3 subagents in parallel', async () => {
      const { fn, calls } = fakeQuery(happyPathMessages());
      const orchestrator = newOrchestrator(fn);
      await orchestrator.reviewPullRequest('udacity', 'repo', 2);

      let text = '';
      for await (const m of calls[0]!.prompt as AsyncIterable<{ message: { content: string } }>) text += m.message.content;
      for (const agent of AGENTS) expect(text).toContain(`Use the ${agent} agent`);
      expect(text).toMatch(/SAME response/);
      expect(orchestrator.lastRunStats?.invokedAgents).toEqual(AGENTS);
      expect(orchestrator.lastRunStats?.skillsInvoked).toContain('security-analysis');
    });

    it('should aggregate results into ReviewReport with recomputed summary', async () => {
      const wrongSummary = { ...validReport, summary: { ...validReport.summary, criticalIssues: 99, totalFiles: 7 } };
      const { fn } = fakeQuery([initMessage(), successResult(wrongSummary)]);
      const report = await newOrchestrator(fn).reviewPullRequest('udacity', 'cd14715-simple-todo-app', 2);

      expect(report.pullRequest).toEqual({ owner: 'udacity', repo: 'cd14715-simple-todo-app', number: 2 });
      expect(report.summary.totalFiles).toBe(1);
      expect(report.summary.criticalIssues).toBe(1);
      expect(report.summary.highPriorityTests).toBe(1);
      expect(report.summary.refactoringOpportunities).toBe(1);
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(report.metadata.agentVersions.model).toBe('test-model');
    });

    it('should validate output with Zod schema', async () => {
      const { fn } = fakeQuery(happyPathMessages());
      const report = await newOrchestrator(fn).reviewPullRequest('udacity', 'repo', 2);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });

    it('throws STRUCTURED_OUTPUT_FAILED when output does not match the schema', async () => {
      const { fn } = fakeQuery([initMessage(), successResult({ fileReviews: 'nope' })]);
      const error = await newOrchestrator(fn).reviewPullRequest('o', 'r', 1).catch(e => e);
      expectFailure(error, ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    });

    it('throws AGENT_FAILED when the session ends with an error subtype', async () => {
      const { fn } = fakeQuery([initMessage(), { type: 'result', subtype: 'error_max_turns', num_turns: 40, total_cost_usd: 1, usage: {} }]);
      const error = await newOrchestrator(fn).reviewPullRequest('o', 'r', 1).catch(e => e);
      expectFailure(error, ErrorCodes.AGENT_FAILED);
    });

    it('fails fast with GITHUB_API_ERROR when the GitHub MCP server cannot connect', async () => {
      const { fn } = fakeQuery([initMessage('failed')]);
      const error = await newOrchestrator(fn).reviewPullRequest('o', 'r', 1).catch(e => e);
      expectFailure(error, ErrorCodes.GITHUB_API_ERROR);
    });

    it('retries a failed attempt with backoff and then succeeds', async () => {
      let attempt = 0;
      const fn: QueryFn = () => {
        attempt++;
        const messages = attempt === 1
          ? [initMessage(), { type: 'result', subtype: 'error_during_execution', num_turns: 1, total_cost_usd: 0, usage: {} }]
          : happyPathMessages();
        return (async function* () { for (const m of messages) yield m as SDKMessage; })();
      };
      const report = await newOrchestrator(fn, { maxRetries: 2 }).reviewPullRequest('o', 'r', 1);
      expect(attempt).toBe(2);
      expect(report.fileReviews).toHaveLength(1);
    });

    it('releases the rate limiter slot even when the review fails', async () => {
      const limiter = new RateLimiter();
      const releaseSpy = vi.spyOn(limiter, 'release');
      const { fn } = fakeQuery([initMessage('failed')]);
      await newOrchestrator(fn, { rateLimiter: limiter }).reviewPullRequest('o', 'r', 1).catch(() => undefined);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(limiter.getStatus().activeRequests).toBe(0);
    });
  });

  describe('Aggregation helpers', () => {
    it('computeSummary returns score 100 and zero counts for an empty PR', () => {
      expect(computeSummary([])).toEqual({
        totalFiles: 0, overallScore: 100, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0
      });
    });

    it('finalizeReport drops duplicate files and derives recommendations when none are given', () => {
      const duplicated = {
        ...validReport,
        fileReviews: [validReport.fileReviews[0]!, validReport.fileReviews[0]!],
        recommendations: []
      };
      const report = finalizeReport(duplicated, { owner: 'o', repo: 'r', prNumber: 3 }, Date.now(), 'm');
      expect(report.fileReviews).toHaveLength(1);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0]!.priority).toBe('critical');
    });
  });

  describe('Integration', () => {
    // Real end-to-end run against a public PR. Needs API credentials, so it is opt-in:
    //   RUN_INTEGRATION=1 npx vitest run tests/orchestrator.test.ts
    // Verified manually with: npm run dev -- octocat Hello-World 1
    it.runIf(process.env.RUN_INTEGRATION === '1')('should review a real small PR (octocat/Hello-World#1)', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
      expect(report.pullRequest.number).toBe(1);
    }, 600_000);
  });
});