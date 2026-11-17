import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

/**
 * Refactoring Suggester
 * Design patterns, extract function/class, modernization, dead/redundant code.
 * Tools (least privilege, read-only):
 * - Skill: loads the language skill
 * - mcp__github__get_file_contents: reads the full file so "before" snippets are exact
 * - Read/Grep/Glob: read and search local files
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Refactoring and architecture specialist. Use this agent to suggest structural improvements to ' +
    'changed source files in a pull request: extract function/class, design patterns, modern language ' +
    'features, simplification and dead code removal, each with before/after code. Returns a JSON array ' +
    'matching RefactoringSuggestionSchema.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Skill', 'Read', 'Grep', 'Glob', 'mcp__github__get_file_contents'],
  model: 'inherit'
};