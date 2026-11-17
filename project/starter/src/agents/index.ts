/**
 * Subagent exports
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { SUBAGENT_NAMES } from '../prompts/orchestrator.prompt.js';
import { codeQualityAnalyzer } from './code-quality-analyzer.js';
import { testCoverageAnalyzer } from './test-coverage-analyzer.js';
import { refactoringSuggester } from './refactoring-suggester.js';

export { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester };

/**
 * Registry passed to the SDK's `agents` option.
 * Keys are the subagent_type names used in the orchestrator prompt - they MUST match.
 */
export const reviewAgents: Record<string, AgentDefinition> = {
  [SUBAGENT_NAMES.codeQuality]: codeQualityAnalyzer,
  [SUBAGENT_NAMES.testCoverage]: testCoverageAnalyzer,
  [SUBAGENT_NAMES.refactoring]: refactoringSuggester
};