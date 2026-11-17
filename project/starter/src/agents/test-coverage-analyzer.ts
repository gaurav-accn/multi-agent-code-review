import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';

/**
 * Test Coverage Analyzer
 * Statically estimates coverage by comparing source files with their test files,
 * finds untested functions/branches and proposes concrete test cases.
 * Tools (least privilege, read-only):
 * - Skill: loads typescript-patterns
 * - mcp__github__get_file_contents: reads source files and lists directories to find tests
 * - mcp__github__search_code: locates tests that reference a function
 * - Read/Grep/Glob: read and search local files
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Test coverage specialist. Use this agent to analyze changed source files in a pull request, ' +
    'find their existing tests, estimate coverage, and list untested functions, branches and edge ' +
    'cases with prioritized, runnable test suggestions. Returns a JSON array matching TestCoverageResultSchema.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Skill', 'Read', 'Grep', 'Glob', 'mcp__github__get_file_contents', 'mcp__github__search_code'],
  model: 'inherit'
};