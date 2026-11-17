import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, parseCliArgs, validateEnvironment } from '../src/config/env.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('parseCliArgs', () => {
  it('parses valid owner, repo and PR number', () => {
    expect(parseCliArgs(['udacity', 'cd14715-simple-todo-app', '2']))
      .toEqual({ owner: 'udacity', repo: 'cd14715-simple-todo-app', prNumber: 2 });
  });

  it.each([
    [[]],
    [['udacity']],
    [['udacity', 'repo']]
  ])('rejects missing arguments %j', (argv) => {
    expect(() => parseCliArgs(argv as string[])).toThrow(ConfigError);
  });

  it.each(['0', '-3', '1.5', '12abc', 'abc'])('rejects invalid PR number "%s"', (pr) => {
    expect(() => parseCliArgs(['udacity', 'repo', pr])).toThrow(/positive integer/);
  });

  it('rejects owner names with invalid characters', () => {
    expect(() => parseCliArgs(['bad owner', 'repo', '1'])).toThrow(/Invalid owner/);
  });
});

describe('validateEnvironment', () => {
  const base = { ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929', PROJECT_ROOT };

  it('accepts Anthropic API key authentication', () => {
    const env = validateEnvironment({ ...base, ANTHROPIC_API_KEY: 'test-key', GITHUB_TOKEN: 'x' });
    expect(env.authMethod).toBe('anthropic-api');
    expect(env.model).toBe('claude-sonnet-4-5-20250929');
    expect(env.warnings).toEqual([]);
  });

  it('accepts AWS Bedrock credentials when AWS_REGION is set', () => {
    const env = validateEnvironment({
      ...base, AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_REGION: 'us-east-1', CLAUDE_CODE_USE_BEDROCK: '1'
    });
    expect(env.authMethod).toBe('aws-bedrock');
  });

  it('requires AWS_REGION when using AWS credentials', () => {
    expect(() => validateEnvironment({ ...base, AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' }))
      .toThrow(/AWS_REGION/);
  });

  it('fails with a helpful message when no authentication is configured', () => {
    const error = (() => { try { validateEnvironment(base); } catch (e) { return e as ConfigError; } })();
    expect(error).toBeInstanceOf(ConfigError);
    expect(error?.message).toBe('No authentication configured');
    expect(error?.hint).toContain('ANTHROPIC_API_KEY');
    expect(error?.hint).toContain('AWS_ACCESS_KEY_ID');
  });

  it('requires ANTHROPIC_MODEL', () => {
    expect(() => validateEnvironment({ ANTHROPIC_API_KEY: 'k', PROJECT_ROOT })).toThrow(/ANTHROPIC_MODEL/);
  });

  it('rejects a PROJECT_ROOT without .claude/skills', () => {
    expect(() => validateEnvironment({ ...base, ANTHROPIC_API_KEY: 'k', PROJECT_ROOT: '/tmp' })).toThrow(/\.claude\/skills/);
  });

  it('warns (but does not fail) when GITHUB_TOKEN is missing', () => {
    const env = validateEnvironment({ ...base, ANTHROPIC_API_KEY: 'k' });
    expect(env.hasGithubToken).toBe(false);
    expect(env.warnings.join(' ')).toContain('GITHUB_TOKEN');
  });
});