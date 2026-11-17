/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 */

export const mcpServersConfig = {
  /**
   * GitHub MCP Server - fetches PR data, changed files and file contents.
   * The server expects GITHUB_PERSONAL_ACCESS_TOKEN, so we map our GITHUB_TOKEN to it.
   * Token is optional for public repos (it only raises the rate limit).
   */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },

  /**
   * ESLint MCP Server - lints local JS/TS files. No authentication needed.
   */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
};

/**
 * Read-only GitHub MCP tools (naming pattern: mcp__<server>__<tool>).
 * These are the tool names exposed by @modelcontextprotocol/server-github.
 */
export const githubTools = [
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__github__search_code'
];

/** ESLint MCP tool */
export const eslintTools = ['mcp__eslint__lint-files'];