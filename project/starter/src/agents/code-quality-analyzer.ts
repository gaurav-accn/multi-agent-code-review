import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

/**
 * Code Quality Analyzer
 * Security vulnerabilities, performance issues, bug risks and best practices.
 * Tools (least privilege, read-only):
 * - Skill: loads typescript-patterns / javascript-best-practices / security-analysis
 * - mcp__github__get_file_contents: reads the full file at the PR head commit
 * - mcp__eslint__lint-files: lints local JS/TS files when available
 * - Read/Grep/Glob: read and search local files
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Code quality and security reviewer. Use this agent to analyze changed source files in a pull ' +
    'request for security vulnerabilities (e.g. SQL injection, secrets, unsafe payment data), ' +
    'performance problems, bug risks and best-practice violations. Returns per-file issues with ' +
    'line numbers, severity and fixes as a JSON array matching CodeQualityResultSchema.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Skill', 'Read', 'Grep', 'Glob', 'mcp__github__get_file_contents', 'mcp__eslint__lint-files'],
  model: 'inherit'
};