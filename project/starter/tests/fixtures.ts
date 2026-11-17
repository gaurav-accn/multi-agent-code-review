/**
 * Shared test fixtures: valid objects for every schema.
 * (Kept outside *.test.ts so importing them doesn't re-run another test file.)
 */
export const validCodeQuality = {
  file: 'src/todo.ts',
  issues: [{
    line: 121,
    severity: 'critical' as const,
    category: 'security' as const,
    description: 'SQL injection via string interpolation',
    suggestion: 'Use a parameterized query'
  }],
  overallScore: 75,
  summary: 'One critical SQL injection.'
};

export const validTestCoverage = {
  file: 'src/todo.ts',
  hasTests: true,
  testFiles: ['src/todo.test.ts'],
  untestedPaths: [{
    type: 'function' as const,
    location: 'searchTodos (lines 119-124)',
    priority: 'high' as const,
    reasoning: 'New query function without tests',
    suggestedTest: "it('escapes keyword', async () => { expect(await searchTodos(\"' OR 1=1\")).toEqual([]); })"
  }],
  coverageEstimate: 40,
  summary: 'Search functions are untested.'
};

export const validRefactoring = {
  file: 'src/todo.ts',
  suggestions: [{
    type: 'extract-function' as const,
    location: 'searchTodos',
    impact: 'medium' as const,
    description: 'Extract query building',
    before: 'const q = `SELECT ... ${k}`;',
    after: 'const q = buildSearchQuery();',
    benefits: 'Single place for safe SQL'
  }],
  summary: 'Some duplication.'
};

export const validReport = {
  pullRequest: { owner: 'udacity', repo: 'cd14715-simple-todo-app', number: 2 },
  fileReviews: [{
    file: 'src/todo.ts',
    codeQuality: validCodeQuality,
    testCoverage: validTestCoverage,
    refactorings: validRefactoring
  }],
  summary: { totalFiles: 1, overallScore: 60, criticalIssues: 1, highPriorityTests: 1, refactoringOpportunities: 1 },
  recommendations: [{ priority: 'critical' as const, category: 'Security', description: 'Parameterize SQL', files: ['src/todo.ts'] }],
  metadata: { analyzedAt: '2026-11-17T09:00:00.000Z', duration: 1234, agentVersions: { orchestrator: '1.0.0' } }
};