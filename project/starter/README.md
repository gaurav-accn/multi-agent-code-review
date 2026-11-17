# Enterprise Multi-Agent Code Review Orchestrator

A multi-agent system built with the **Claude Agent SDK** that reviews GitHub pull requests.
An orchestrator fetches the PR through the **GitHub MCP server** and dispatches three
specialised subagents **in parallel**. It then validates their combined findings against a
**Zod** schema and writes the result as JSON, Markdown and HTML reports.

```
                 ┌──────────────────────────────────────┐
                 │            ORCHESTRATOR              │
                 │  GitHub MCP → Task tool → aggregate  │
                 └──────────────────┬───────────────────┘
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ code-quality-    │     │ test-coverage-   │     │ refactoring-     │
│ analyzer         │     │ analyzer         │     │ suggester        │
│ security, perf,  │     │ gaps, priorities,│     │ patterns, before/│
│ best practices   │     │ runnable tests   │     │ after code       │
└──────────────────┘     └──────────────────┘     └──────────────────┘
          └─────────────────────────┼─────────────────────────┘
                                    ▼
             ReviewReport (Zod-validated structured output)
                                    ▼
            reports/<owner>_<repo>_<pr>.{json, md, html}
```

## Features

- **3 subagents** (`AgentDefinition`, `model: 'inherit'`, least-privilege read-only tools, all with the `Skill` tool)
- **Claude Skills** in `.claude/skills/`: `typescript-patterns`, `security-analysis`, `javascript-best-practices`
- **MCP**: GitHub (`@modelcontextprotocol/server-github`) and ESLint (`@eslint/mcp`) over stdio
- **Structured output**: `outputFormat` built with `zod-to-json-schema` (`$refStrategy: 'root'`), validated with `safeParse`
- **Reliability**: retry with exponential backoff and jitter, `Promise.race` timeout, sliding-window rate limiter
- **Guardrails**: `permissionMode: 'dontAsk'` with an explicit allow-list. Bash, Write, Edit and GitHub write tools are disallowed.
- **Trustworthy numbers**: summary scores are recomputed in code from the aggregated findings, not taken from the model

## Setup

Requirements: Node.js 18+ and an Anthropic API key (or AWS Bedrock credentials).

```bash
cd project/starter
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Example / notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes* | API key (*or AWS credentials below) |
| `ANTHROPIC_BASE_URL` | No | Only when using Udacity/Vocareum credentials |
| `ANTHROPIC_MODEL` | Yes | `claude-sonnet-4-5-20250929` |
| `PROJECT_ROOT` | Yes | Absolute path of `project/starter` (run `pwd` inside it) |
| `GITHUB_TOKEN` | Recommended | Higher GitHub rate limits; set automatically in GitHub Codespaces |
| `LOG_LEVEL` | No | `error`, `warn`, `info` (default), `debug` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `CLAUDE_CODE_USE_BEDROCK=1` | Alt. | AWS Bedrock instead of the Anthropic API |

No secrets are stored in source code. `.env` is git-ignored.

**GitHub Codespaces:** `PROJECT_ROOT=/workspaces/<repo-name>/project/starter`. Codespaces already provides `GITHUB_TOKEN`.

## Usage

```bash
npm run dev -- <owner> <repo> <pr-number>

npm run dev -- udacity cd14715-simple-todo-app 2   # review a PR
npm run dev -- octocat Hello-World 1               # integration smoke test
```

Arguments and environment are validated up front, so mistakes produce actionable messages instead of stack traces:

```
❌ PR number must be a positive integer, got "12abc"
Usage: npm run dev -- <owner> <repo> <pr-number>
```

Logs show each step: MCP connection status, every `Task` subagent invocation, `Skill` usage
and the MCP calls made by each agent. Full logs are in `logs/combined.log`.

## Reports

Each run writes three files to `reports/`:

| File | Contents |
|---|---|
| `*.json` | Full `ReviewReport` (schema-valid) |
| `*.md` | Summary table, recommendations, issues with line and severity, test suggestions with code, refactorings with before/after |
| `*.html` | Styled, self-contained page with the same content (model output is HTML-escaped) |

### Results for `udacity/cd14715-simple-todo-app`

| PR | File | Score | Critical issues | High-priority tests | Refactorings |
|---|---|---|---|---|---|
| #1 add clean code fixture | `fixtures/clean-code.ts` | 65 | 0 | 6 | 5 |
| #2 search functionality | `src/todo.ts` | 9 | 3 (SQL injection) | 10 | 5 |
| #3 premium subscriptions | `src/premium.ts` | 2 | 3 | 11 | 10 |

## Testing

```bash
npm run build   # TypeScript compile
npm test        # Vitest unit tests (no API key needed)
```

| Test file | Covers |
|---|---|
| `tests/schemas.test.ts` | Valid/invalid data, enums, boundaries (0/100), empty arrays, JSON Schema export |
| `tests/utils.test.ts` | `withRetry` backoff and exhaustion, `withTimeout`, rate limiter sliding window and concurrency |
| `tests/env.test.ts` | CLI argument parsing and environment validation |
| `tests/orchestrator.test.ts` | SDK options, subagent invocation, aggregation, Zod validation, failure and retry paths (SDK `query` injected) |
| `tests/report-generator.test.ts` | Markdown/HTML/JSON content, HTML escaping, file names |

The real end-to-end integration test (`octocat/Hello-World#1`) is opt-in because it needs API credentials:

```bash
RUN_INTEGRATION=1 npx vitest run tests/orchestrator.test.ts
```

## Project structure

```
src/
├── agents/            # 3 AgentDefinitions + registry (reviewAgents)
├── prompts/           # orchestrator + 3 subagent prompts
├── config/
│   ├── mcp.config.ts  # GitHub + ESLint MCP servers, tool lists
│   ├── env.ts         # CLI + environment validation
│   └── load-env.ts    # loads .env before other modules
├── types/             # Zod schemas (provided)
├── utils/             # error-handler, rate-limiter, logger, report-generator
├── orchestrator.ts    # CodeReviewOrchestrator (query, aggregation, validation)
└── main.ts            # CLI entry point
.claude/skills/        # Claude Skills used by the subagents
tests/                 # Vitest unit tests
reports/               # Generated reports
```

## Design notes

- **Parallel subagents:** the three analyses are independent, so the orchestrator prompt requires all three `Task` calls in a single response.
- **Real line numbers:** subagents fetch the full file at the PR head SHA with `mcp__github__get_file_contents`, so reported lines match the file, not diff offsets.
- **Graceful degradation:** a failed subagent is retried once by the orchestrator. If it fails again, a placeholder marked `ANALYSIS UNAVAILABLE` is used and excluded from scoring. A failed or invalid session is retried with backoff. A GitHub MCP connection failure fails fast with a clear error.
- **Scoring:** per file, 60% code quality + 25% estimated coverage + 15% refactoring health, averaged across files.