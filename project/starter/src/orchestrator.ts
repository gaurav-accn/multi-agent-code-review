import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { reviewAgents } from './agents/index.js';
import { eslintTools, githubTools, mcpServersConfig } from './config/mcp.config.js';
import { buildOrchestratorPrompt, SUBAGENT_NAMES } from './prompts/index.js';
import { ReviewReportJSONSchema, ReviewReportSchema } from './types/report-types.js';
import type { ReviewReport } from './types/report-types.js';
import { ErrorCodes, ReviewError, formatError, withRetry, withTimeout } from './utils/error-handler.js';
import { logger, logReviewComplete, logReviewError, logReviewStart } from './utils/logger.js';
import { RateLimiter } from './utils/rate-limiter.js';
import type { RateLimiterConfig } from './utils/rate-limiter.js';

export const AGENT_VERSION = '1.0.0';

const DEFAULT_MAX_TURNS = 40;
const DEFAULT_TIMEOUT_MS = 15 * 60_000; // one review = 1 orchestrator + 3 subagents
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_ESTIMATED_TOKENS = 50_000;

/**
 * Tools the orchestrator session may use.
 * - Task spawns subagents (REQUIRED for multi-agent orchestration)
 * - GitHub/ESLint MCP tools come from the connected MCP servers
 * - Skill/Read/Grep/Glob are listed so the subagents' tools are pre-approved
 *   (with permissionMode 'dontAsk', anything not listed here is denied)
 */
export const ORCHESTRATOR_ALLOWED_TOOLS: string[] = [
  'Task',
  ...githubTools,
  ...eslintTools,
  'Skill',
  'Read',
  'Grep',
  'Glob'
];

/** Guardrail: this system only reads code - it never edits files, runs shell commands or writes to GitHub */
export const ORCHESTRATOR_DISALLOWED_TOOLS: string[] = [
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'mcp__github__create_or_update_file',
  'mcp__github__push_files',
  'mcp__github__create_branch',
  'mcp__github__create_issue',
  'mcp__github__add_issue_comment',
  'mcp__github__create_pull_request',
  'mcp__github__create_pull_request_review',
  'mcp__github__merge_pull_request'
];

/**
 * JSON Schema for SDK structured outputs (from Zod via zod-to-json-schema with
 * $refStrategy: 'root'). The top-level "$schema" key is dropped - the API only needs the schema body.
 */
const { $schema: _ignored, ...REVIEW_REPORT_OUTPUT_SCHEMA } = ReviewReportJSONSchema as Record<string, unknown>;
export { REVIEW_REPORT_OUTPUT_SCHEMA };

/** Signature of the SDK query function (injectable so tests can run without the API) */
export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Model id; defaults to process.env.ANTHROPIC_MODEL (never hardcoded) */
  model?: string;
  /** Directory containing .claude/skills; defaults to PROJECT_ROOT or cwd */
  projectRoot?: string;
  /** Max orchestrator turns per run */
  maxTurns?: number;
  /** Timeout for one complete review attempt */
  timeoutMs?: number;
  /** Total attempts for a review (first try + retries) */
  maxRetries?: number;
  /** Base delay for exponential backoff between attempts */
  retryDelayMs?: number;
  /** Token estimate reserved in the rate limiter per review attempt */
  estimatedTokensPerReview?: number;
  /** Custom rate limits (ignored when rateLimiter is given) */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Shared rate limiter instance */
  rateLimiter?: RateLimiter;
  /** Dependency injection for tests */
  queryFn?: QueryFn;
}

/** Diagnostics from the most recent run */
export interface ReviewRunStats {
  invokedAgents: string[];
  skillsInvoked: string[];
  mcpServers: Array<{ name: string; status: string }>;
  numTurns?: number;
  totalCostUsd?: number;
  tokensUsed?: number;
}

interface AttemptResult {
  report: ReviewReport;
  stats: ReviewRunStats;
}

/** Errors that will not be fixed by retrying */
const NON_RETRYABLE: ReadonlySet<string> = new Set([
  ErrorCodes.INVALID_CONFIG,
  ErrorCodes.MISSING_API_KEY,
  ErrorCodes.PR_NOT_FOUND
]);

const isRetryable = (error: unknown): boolean =>
  !(error instanceof ReviewError && NON_RETRYABLE.has(error.code));

/** Streaming input mode (recommended for MCP compatibility) */
async function* singleUserMessage(text: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: 'code-review-session'
  };
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  readonly model: string;
  readonly projectRoot: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly estimatedTokensPerReview: number;
  readonly rateLimiter: RateLimiter;
  private readonly queryFn: QueryFn;

  /** Diagnostics of the last successful run (used by the CLI) */
  lastRunStats?: ReviewRunStats;

  constructor(options: OrchestratorOptions = {}) {
    const model = options.model ?? process.env.ANTHROPIC_MODEL;
    if (!model) {
      throw new ReviewError(
        'ANTHROPIC_MODEL environment variable is required',
        ErrorCodes.INVALID_CONFIG
      );
    }
    this.model = model;
    this.projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.estimatedTokensPerReview = options.estimatedTokensPerReview ?? DEFAULT_ESTIMATED_TOKENS;
    this.rateLimiter = options.rateLimiter ?? new RateLimiter(options.rateLimits);
    this.queryFn = options.queryFn ?? (sdkQuery as QueryFn);
  }

  /**
   * SDK options for the orchestrator session
   */
  buildQueryOptions(abortController?: AbortController): Options {
    return {
      model: this.model,
      cwd: this.projectRoot,
      // Load .claude/skills (and project settings) so the Skill tool can find our skills
      settingSources: ['project'],
      mcpServers: mcpServersConfig,
      agents: reviewAgents,
      allowedTools: ORCHESTRATOR_ALLOWED_TOOLS,
      disallowedTools: ORCHESTRATOR_DISALLOWED_TOOLS,
      // Non-interactive (CI/CD): never prompt - allowedTools run, everything else is denied
      permissionMode: 'dontAsk',
      maxTurns: this.maxTurns,
      outputFormat: {
        type: 'json_schema',
        schema: REVIEW_REPORT_OUTPUT_SCHEMA
      },
      abortController,
      stderr: (data: string) => logger.debug('claude-code stderr', { data: data.trim() })
    };
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();
    logReviewStart(owner, repo, prNumber);

    try {
      const { report, stats } = await withRetry(
        () => this.runAttempt(owner, repo, prNumber),
        this.maxRetries,
        this.retryDelayMs,
        (error) => {
          const retry = isRetryable(error);
          if (retry) logger.warn('Review attempt failed - retrying with backoff', { error: formatError(error) });
          return retry;
        }
      );

      const finalReport = finalizeReport(report, { owner, repo, prNumber }, startedAt, this.model);

      // Final gate: the object we hand to the report generator must satisfy the schema
      const validated = ReviewReportSchema.safeParse(finalReport);
      if (!validated.success) {
        throw new ReviewError(
          'Aggregated report failed ReviewReport schema validation',
          ErrorCodes.VALIDATION_FAILED,
          { issues: validated.error.issues.slice(0, 10) }
        );
      }

      this.lastRunStats = stats;
      logReviewComplete(owner, repo, prNumber, validated.data.summary.overallScore, validated.data.metadata.duration);
      return validated.data;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * One attempt = rate-limited, time-limited orchestrator session.
   */
  private async runAttempt(owner: string, repo: string, prNumber: number): Promise<AttemptResult> {
    await this.rateLimiter.acquire(this.estimatedTokensPerReview);
    const abortController = new AbortController();
    let tokensUsed: number | undefined;

    try {
      const result = await withTimeout(
        () => this.runQuery(owner, repo, prNumber, abortController),
        this.timeoutMs,
        `Review of ${owner}/${repo}#${prNumber} timed out after ${Math.round(this.timeoutMs / 1000)}s`
      );
      tokensUsed = result.stats.tokensUsed;
      return result;
    } catch (error) {
      // Stop the underlying Claude Code process (e.g. after a timeout)
      abortController.abort();
      throw error;
    } finally {
      this.rateLimiter.release(tokensUsed);
    }
  }

  /**
   * Run the orchestrator session and return the validated structured output.
   */
  private async runQuery(
    owner: string,
    repo: string,
    prNumber: number,
    abortController: AbortController
  ): Promise<AttemptResult> {
    const stats: ReviewRunStats = { invokedAgents: [], skillsInvoked: [], mcpServers: [] };
    const taskCalls = new Map<string, string>(); // tool_use_id -> subagent name

    const stream = this.queryFn({
      prompt: singleUserMessage(buildOrchestratorPrompt(owner, repo, prNumber)),
      options: this.buildQueryOptions(abortController)
    });

    for await (const message of stream) {
      if (message.type === 'system' && message.subtype === 'init') {
        this.handleInit(message, stats);
        continue;
      }

      if (message.type === 'assistant') {
        this.trackToolUse(message, stats, taskCalls);
        continue;
      }

      if (message.type === 'user') {
        this.trackSubagentResults(message, taskCalls);
        continue;
      }

      if (message.type === 'result') {
        stats.numTurns = message.num_turns;
        stats.totalCostUsd = message.total_cost_usd;
        stats.tokensUsed = (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);

        if (message.subtype === 'success') {
          const report = this.validateStructuredOutput(message.structured_output);
          const missing = Object.values(SUBAGENT_NAMES).filter(a => !stats.invokedAgents.includes(a));
          if (missing.length > 0 && report.fileReviews.length > 0) {
            logger.warn('Some subagents were not invoked by the orchestrator', { missing });
          }
          logger.info('Orchestrator finished', {
            turns: stats.numTurns,
            costUsd: stats.totalCostUsd,
            subagents: stats.invokedAgents
          });
          return { report, stats };
        }

        if (message.subtype === 'error_max_structured_output_retries') {
          throw new ReviewError(
            'Model could not produce output matching the ReviewReport schema',
            ErrorCodes.STRUCTURED_OUTPUT_FAILED
          );
        }

        throw new ReviewError(
          `Orchestrator run ended with "${message.subtype}"` +
            (message.subtype === 'error_max_turns' ? ` (maxTurns=${this.maxTurns})` : ''),
          ErrorCodes.AGENT_FAILED,
          { subtype: message.subtype, turns: message.num_turns }
        );
      }
    }

    throw new ReviewError('Orchestrator stream ended without a result message', ErrorCodes.AGENT_FAILED);
  }

  /** Parse + validate the SDK structured output with Zod (safeParse, never trust blindly) */
  private validateStructuredOutput(output: unknown): ReviewReport {
    if (output === undefined || output === null) {
      throw new ReviewError('Orchestrator returned no structured output', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    }

    let candidate = output;
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        throw new ReviewError('Structured output was a string but not valid JSON', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
      }
    }

    const parsed = ReviewReportSchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 10).map(i => `${i.path.join('.')}: ${i.message}`);
      logger.error('Structured output failed Zod validation', { issues });
      throw new ReviewError(
        'Structured output did not match the ReviewReport schema',
        ErrorCodes.STRUCTURED_OUTPUT_FAILED,
        { issues }
      );
    }
    return parsed.data;
  }

  private handleInit(message: Extract<SDKMessage, { type: 'system'; subtype: 'init' }>, stats: ReviewRunStats): void {
    stats.mcpServers = message.mcp_servers.map(s => ({ name: s.name, status: s.status }));

    for (const server of stats.mcpServers) {
      const level = server.status === 'connected' ? 'info' : 'warn';
      logger.log(level, `MCP server "${server.name}": ${server.status}`);
    }

    const github = stats.mcpServers.find(s => s.name === 'github');
    if (!github || github.status === 'failed') {
      // Without GitHub we cannot fetch the PR at all - fail this attempt (retryable)
      throw new ReviewError(
        'GitHub MCP server failed to connect',
        ErrorCodes.GITHUB_API_ERROR,
        { mcpServers: stats.mcpServers }
      );
    }

    const registeredAgents = message.agents ?? [];
    const missingAgents = Object.values(SUBAGENT_NAMES).filter(a => !registeredAgents.includes(a));
    if (missingAgents.length > 0) {
      logger.warn('Subagents missing from SDK session', { missingAgents, registeredAgents });
    }
    logger.info('Session initialised', {
      model: message.model,
      agents: registeredAgents.filter(a => (Object.values(SUBAGENT_NAMES) as string[]).includes(a)),
      skills: message.skills
    });
  }

  private trackToolUse(
    message: Extract<SDKMessage, { type: 'assistant' }>,
    stats: ReviewRunStats,
    taskCalls: Map<string, string>
  ): void {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    const insideSubagent = !!message.parent_tool_use_id;
    const owner = insideSubagent ? taskCalls.get(message.parent_tool_use_id ?? '') ?? 'subagent' : 'orchestrator';

    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      const input = (block.input ?? {}) as Record<string, unknown>;

      if (block.name === 'Task') {
        const agent = String(input.subagent_type ?? 'unknown');
        taskCalls.set(block.id, agent);
        if (!stats.invokedAgents.includes(agent)) stats.invokedAgents.push(agent);
        logger.info(`🤖 Task → invoking subagent "${agent}"`, { description: input.description });
      } else if (block.name === 'Skill') {
        const skill = String(input.skill ?? input.command ?? input.name ?? 'unknown');
        if (!stats.skillsInvoked.includes(skill)) stats.skillsInvoked.push(skill);
        logger.info(`📚 [${owner}] Skill → ${skill}`);
      } else if (block.name.startsWith('mcp__')) {
        logger.info(`🔌 [${owner}] MCP → ${block.name}`, { path: input.path });
      } else {
        logger.debug(`🔧 [${owner}] ${block.name}`);
      }
    }
  }

  private trackSubagentResults(
    message: Extract<SDKMessage, { type: 'user' }>,
    taskCalls: Map<string, string>
  ): void {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (typeof block !== 'object' || block === null || block.type !== 'tool_result') continue;
      const agent = taskCalls.get(block.tool_use_id);
      if (!agent) continue;
      if (block.is_error) {
        logger.warn(`Subagent "${agent}" returned an error - orchestrator will retry or degrade gracefully`);
      } else {
        logger.info(`✅ Subagent "${agent}" completed`);
      }
    }
  }
}

/** Alias matching the course's quick-test snippet: `new Orchestrator()` */
export { CodeReviewOrchestrator as Orchestrator };

// ---------------------------------------------------------------------------
// Aggregation helpers (pure functions - unit tested)
// ---------------------------------------------------------------------------

type FileReview = ReviewReport['fileReviews'][number];
type Priority = ReviewReport['recommendations'][number]['priority'];

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const IMPACT_PENALTY = { high: 15, medium: 8, low: 3 } as const;
const UNAVAILABLE = 'ANALYSIS UNAVAILABLE';

const clamp = (n: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

/** Refactoring health: 100 minus a penalty per suggestion, weighted by impact */
export function refactoringHealth(review: FileReview): number {
  const penalty = review.refactorings.suggestions.reduce((sum, s) => sum + IMPACT_PENALTY[s.impact], 0);
  return clamp(100 - penalty);
}

/**
 * Overall score for one file:
 * 60% code quality + 25% test coverage + 15% refactoring health.
 * Components whose agent failed (placeholder results) are excluded and weights renormalised.
 */
export function fileScore(review: FileReview): number | null {
  const parts: Array<[number, number]> = [];
  if (!review.codeQuality.summary.startsWith(UNAVAILABLE)) parts.push([0.6, review.codeQuality.overallScore]);
  if (!review.testCoverage.summary.startsWith(UNAVAILABLE)) parts.push([0.25, review.testCoverage.coverageEstimate]);
  if (!review.refactorings.summary.startsWith(UNAVAILABLE)) parts.push([0.15, refactoringHealth(review)]);
  const weight = parts.reduce((s, [w]) => s + w, 0);
  if (weight === 0) return null;
  return parts.reduce((s, [w, v]) => s + w * v, 0) / weight;
}

/** Recompute summary numbers from the aggregated findings (don't trust model arithmetic) */
export function computeSummary(fileReviews: FileReview[]): ReviewReport['summary'] {
  const issues = fileReviews.flatMap(r => r.codeQuality.issues);
  const gaps = fileReviews.flatMap(r => r.testCoverage.untestedPaths);
  const scores = fileReviews.map(fileScore).filter((s): s is number => s !== null);

  return {
    totalFiles: fileReviews.length,
    overallScore: scores.length === 0
      ? (fileReviews.length === 0 ? 100 : 0)
      : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    criticalIssues: issues.filter(i => i.severity === 'critical').length,
    highPriorityTests: gaps.filter(g => g.priority === 'critical' || g.priority === 'high').length,
    refactoringOpportunities: fileReviews.reduce((sum, r) => sum + r.refactorings.suggestions.length, 0)
  };
}

/** Build recommendations from findings when the model returned none */
export function deriveRecommendations(fileReviews: FileReview[]): ReviewReport['recommendations'] {
  const recs: ReviewReport['recommendations'] = [];

  for (const review of fileReviews) {
    for (const issue of review.codeQuality.issues) {
      if (issue.severity === 'critical' || issue.severity === 'high') {
        recs.push({
          priority: issue.severity,
          category: issue.category === 'security' ? 'Security' : 'Code Quality',
          description: `Line ${issue.line}: ${issue.description} Fix: ${issue.suggestion}`,
          files: [review.file]
        });
      }
    }
    const urgentTests = review.testCoverage.untestedPaths.filter(p => p.priority === 'critical' || p.priority === 'high');
    if (urgentTests.length > 0) {
      recs.push({
        priority: urgentTests.some(p => p.priority === 'critical') ? 'critical' : 'high',
        category: 'Testing',
        description: `Add tests for: ${urgentTests.map(p => p.location).join('; ')}`,
        files: [review.file]
      });
    }
    for (const s of review.refactorings.suggestions.filter(x => x.impact === 'high')) {
      recs.push({ priority: 'medium', category: 'Refactoring', description: `${s.location}: ${s.description}`, files: [review.file] });
    }
  }
  return recs.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).slice(0, 8);
}

/**
 * Normalise the model's report: authoritative PR identity, consistent file names,
 * integer line numbers, recomputed summary, sorted recommendations and measured metadata.
 */
export function finalizeReport(
  report: ReviewReport,
  pr: { owner: string; repo: string; prNumber: number },
  startedAt: number,
  model: string
): ReviewReport {
  const seen = new Set<string>();
  const fileReviews: FileReview[] = [];

  for (const review of report.fileReviews) {
    if (seen.has(review.file)) continue; // drop duplicate entries for the same file
    seen.add(review.file);
    fileReviews.push({
      file: review.file,
      codeQuality: {
        ...review.codeQuality,
        file: review.file,
        overallScore: Math.round(clamp(review.codeQuality.overallScore)),
        issues: review.codeQuality.issues.map(i => ({ ...i, line: Math.max(1, Math.round(i.line)) }))
      },
      testCoverage: {
        ...review.testCoverage,
        file: review.file,
        coverageEstimate: Math.round(clamp(review.testCoverage.coverageEstimate))
      },
      refactorings: { ...review.refactorings, file: review.file }
    });
  }

  const recommendations = (report.recommendations.length > 0
    ? [...report.recommendations]
    : deriveRecommendations(fileReviews)
  ).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return {
    pullRequest: { owner: pr.owner, repo: pr.repo, number: pr.prNumber },
    fileReviews,
    summary: computeSummary(fileReviews),
    recommendations,
    metadata: {
      analyzedAt: new Date().toISOString(),
      duration: Date.now() - startedAt,
      agentVersions: {
        orchestrator: AGENT_VERSION,
        [SUBAGENT_NAMES.codeQuality]: AGENT_VERSION,
        [SUBAGENT_NAMES.testCoverage]: AGENT_VERSION,
        [SUBAGENT_NAMES.refactoring]: AGENT_VERSION,
        model
      }
    }
  };
}