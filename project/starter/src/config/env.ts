import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * CLI + environment validation.
 * Pure functions (no process.exit) so they can be unit tested; main.ts decides how to exit.
 */

export const USAGE = 'Usage: npm run dev -- <owner> <repo> <pr-number>\n' +
  'Example: npm run dev -- udacity cd14715-simple-todo-app 2';

export class ConfigError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface CliArgs {
  owner: string;
  repo: string;
  prNumber: number;
}

// GitHub owner/repo names: letters, digits, '-', '_', '.'
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse and validate `<owner> <repo> <pr-number>`.
 * @param argv - process.argv.slice(2)
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const [owner, repo, prStr] = argv;

  if (!owner || !repo || !prStr) {
    const missing = [
      !owner && 'owner',
      !repo && 'repo',
      !prStr && 'pr-number'
    ].filter(Boolean).join(', ');
    throw new ConfigError(`Missing required argument(s): ${missing}`, USAGE);
  }

  if (!GITHUB_NAME.test(owner)) {
    throw new ConfigError(`Invalid owner "${owner}"`, 'Owner may only contain letters, digits, "-", "_" and "."');
  }
  if (!GITHUB_NAME.test(repo)) {
    throw new ConfigError(`Invalid repo "${repo}"`, 'Repo may only contain letters, digits, "-", "_" and "."');
  }

  // Reject "12abc", "1.5", "-3", "0" - parseInt alone would accept "12abc"
  if (!/^\d+$/.test(prStr)) {
    throw new ConfigError(`PR number must be a positive integer, got "${prStr}"`, USAGE);
  }
  const prNumber = parseInt(prStr, 10);
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new ConfigError(`PR number must be a positive integer, got "${prStr}"`, USAGE);
  }

  return { owner, repo, prNumber };
}

export type AuthMethod = 'anthropic-api' | 'aws-bedrock';

export interface ValidatedEnv {
  authMethod: AuthMethod;
  model: string;
  projectRoot: string;
  hasGithubToken: boolean;
  warnings: string[];
}

/**
 * Validate authentication, model and project root.
 * Accepts either ANTHROPIC_API_KEY, or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_REGION).
 */
export function validateEnvironment(
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd()
): ValidatedEnv {
  const warnings: string[] = [];

  // ---- Authentication (one of two methods) ----
  const hasAnthropicApi = !!env.ANTHROPIC_API_KEY?.trim();
  const hasAwsKeys = !!(env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim());

  let authMethod: AuthMethod;
  if (hasAnthropicApi) {
    authMethod = 'anthropic-api';
  } else if (hasAwsKeys) {
    if (!env.AWS_REGION?.trim()) {
      throw new ConfigError(
        'AWS credentials found but AWS_REGION is not set',
        'Add AWS_REGION=us-east-1 (or your region) to .env'
      );
    }
    if (env.CLAUDE_CODE_USE_BEDROCK !== '1') {
      warnings.push('Using AWS credentials: set CLAUDE_CODE_USE_BEDROCK=1 in .env so the SDK routes to Bedrock.');
    }
    authMethod = 'aws-bedrock';
  } else {
    throw new ConfigError(
      'No authentication configured',
      'Set ONE of the following in .env (or as a Codespaces secret):\n' +
      '  - ANTHROPIC_API_KEY=sk-ant-...   (Anthropic API; add ANTHROPIC_BASE_URL if using Udacity/Vocareum credentials)\n' +
      '  - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION   (AWS Bedrock)'
    );
  }

  // ---- Model (required for both auth methods) ----
  const model = env.ANTHROPIC_MODEL?.trim();
  if (!model) {
    throw new ConfigError(
      'ANTHROPIC_MODEL environment variable is required',
      'Add to .env:\n' +
      '  - Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n' +
      '  - AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    );
  }

  // ---- Project root (must contain .claude/skills for the Skill tool) ----
  let projectRoot = env.PROJECT_ROOT?.trim();
  if (!projectRoot) {
    if (existsSync(path.join(cwd, '.claude', 'skills'))) {
      projectRoot = cwd;
      warnings.push(`PROJECT_ROOT not set - using current directory ${cwd}`);
    } else {
      throw new ConfigError(
        'PROJECT_ROOT is required',
        'Add the absolute path of project/starter to .env, e.g.\n' +
        '  PROJECT_ROOT=/workspaces/<your-repo>/project/starter   (GitHub Codespaces)\n' +
        'Tip: run `pwd` inside project/starter to get it.'
      );
    }
  }
  if (!path.isAbsolute(projectRoot)) {
    throw new ConfigError(`PROJECT_ROOT must be an absolute path, got "${projectRoot}"`, 'Run `pwd` inside project/starter and paste the result.');
  }
  if (!existsSync(path.join(projectRoot, '.claude', 'skills'))) {
    throw new ConfigError(
      `PROJECT_ROOT (${projectRoot}) does not contain .claude/skills/`,
      'PROJECT_ROOT must point at the project/starter directory. Run `pwd` inside it and paste the result.'
    );
  }

  // ---- GitHub token (recommended, not required for public repos) ----
  const hasGithubToken = !!env.GITHUB_TOKEN?.trim();
  if (!hasGithubToken) {
    warnings.push('GITHUB_TOKEN not set - public repos still work but GitHub allows only 60 unauthenticated requests/hour.');
  }

  return { authMethod, model, projectRoot, hasGithubToken, warnings };
}