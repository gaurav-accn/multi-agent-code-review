// Must be the first import: loads .env before the logger/config modules read process.env
import './config/load-env.js';

import path from 'node:path';
import { ConfigError, parseCliArgs, validateEnvironment } from './config/env.js';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ErrorCodes, isReviewError } from './utils/error-handler.js';
import { ReportGenerator } from './utils/report-generator.js';
import { logger } from './utils/logger.js';

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev -- <owner> <repo> <pr-number>
 *
 * Integration test (course requirement): `npm run dev -- octocat Hello-World 1`
 * fetches a real public PR through the GitHub MCP server, runs all three subagents
 * and writes reports/octocat_Hello-World_1.{json,md,html}.
 */
async function main(): Promise<number> {
  // ---- 1. Validate command-line arguments ----
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    return printConfigError(error);
  }
  const { owner, repo, prNumber } = args;

  // ---- 2. Validate authentication, model and project root ----
  let env;
  try {
    env = validateEnvironment(process.env);
  } catch (error) {
    return printConfigError(error);
  }

  console.log(env.authMethod === 'aws-bedrock'
    ? '🔐 Using AWS Bedrock authentication'
    : '🔐 Using Anthropic API authentication');
  console.log(`🧠 Model: ${env.model}`);
  for (const warning of env.warnings) console.warn(`⚠️  ${warning}`);

  // ---- 3. Run the multi-agent review ----
  console.log(`\n🔍 Reviewing ${owner}/${repo}#${prNumber} (this usually takes 2-6 minutes)...\n`);

  try {
    const orchestrator = new CodeReviewOrchestrator({
      model: env.model,
      projectRoot: env.projectRoot
    });

    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // ---- 4. Generate reports (JSON, Markdown, HTML) ----
    const generator = new ReportGenerator();
    const outputDir = path.join(env.projectRoot, 'reports');
    const saved = await generator.saveAll(report, outputDir);

    const { summary } = report;
    console.log('\n✅ Review complete');
    console.log(`   Overall score:      ${summary.overallScore}/100`);
    console.log(`   Files reviewed:     ${summary.totalFiles}`);
    console.log(`   Critical issues:    ${summary.criticalIssues}`);
    console.log(`   High-priority tests:${summary.highPriorityTests}`);
    console.log(`   Refactorings:       ${summary.refactoringOpportunities}`);
    if (orchestrator.lastRunStats) {
      const s = orchestrator.lastRunStats;
      console.log(`   Subagents invoked:  ${s.invokedAgents.join(', ') || 'none'}`);
      console.log(`   Skills invoked:     ${s.skillsInvoked.join(', ') || 'none'}`);
      if (s.totalCostUsd !== undefined) console.log(`   Cost:               $${s.totalCostUsd.toFixed(3)}`);
    }
    console.log('\n📄 Reports saved:');
    console.log(`   JSON:     ${path.relative(process.cwd(), saved.json)}`);
    console.log(`   Markdown: ${path.relative(process.cwd(), saved.markdown)}`);
    console.log(`   HTML:     ${path.relative(process.cwd(), saved.html)}`);
    return 0;
  } catch (error) {
    printRuntimeError(error, owner, repo, prNumber);
    return 1;
  }
}

function printConfigError(error: unknown): number {
  if (error instanceof ConfigError) {
    console.error(`❌ ${error.message}`);
    if (error.hint) console.error(`\n${error.hint}`);
  } else {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  }
  return 1;
}

/** Friendly, actionable messages instead of stack traces */
function printRuntimeError(error: unknown, owner: string, repo: string, prNumber: number): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Review of ${owner}/${repo}#${prNumber} failed: ${message}`);

  const hints: Record<string, string> = {
    [ErrorCodes.GITHUB_API_ERROR]: 'Check the repo/PR exist and are public, that `npx` works, and set GITHUB_TOKEN for higher rate limits.',
    [ErrorCodes.STRUCTURED_OUTPUT_FAILED]: 'The model output did not match the ReviewReport schema. Re-run; run with LOG_LEVEL=debug to see details.',
    [ErrorCodes.AGENT_TIMEOUT]: 'The review took too long. Re-run, or check your network/API connectivity.',
    [ErrorCodes.AGENT_FAILED]: 'The agent session ended early. Run with LOG_LEVEL=debug and check logs/error.log.',
    [ErrorCodes.RETRY_EXHAUSTED]: 'All retries failed. See the reason above and logs/error.log.',
    [ErrorCodes.INVALID_CONFIG]: 'Check your .env file (ANTHROPIC_MODEL, PROJECT_ROOT).'
  };

  if (isReviewError(error)) {
    console.error(`   Error code: ${error.code}`);
    console.error(`   Hint: ${hints[error.code] ?? 'See logs/error.log for details.'}`);
  }
  if (/401|authentication|api key|invalid x-api-key/i.test(message)) {
    console.error('   Hint: authentication failed - verify ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL if using Udacity/Vocareum credentials).');
  }
  if (/rate limit|429/i.test(message)) {
    console.error('   Hint: rate limited - wait a minute and retry, or set GITHUB_TOKEN for GitHub API limits.');
  }
  console.error('   Full details: logs/error.log');
}

main()
  .then(code => {
    process.exitCode = code;
    // Give winston a moment to flush file transports before exiting
    logger.on('finish', () => process.exit(code));
    logger.end();
    setTimeout(() => process.exit(code), 500).unref();
  })
  .catch(error => {
    console.error('❌ Unexpected error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });