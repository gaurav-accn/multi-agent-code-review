import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  ReviewReportJSONSchema,
  CodeQualityResultJSONSchema
} from '../src/types/index.js';

import {
  validCodeQuality,
  validTestCoverage,
  validRefactoring,
  validReport
} from './fixtures.js';

describe('CodeQualityResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => CodeQualityResultSchema.parse(validCodeQuality)).not.toThrow();
  });

  it('rejects an invalid severity enum value', () => {
    const bad = { ...validCodeQuality, issues: [{ ...validCodeQuality.issues[0], severity: 'urgent' }] };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects an invalid category enum value', () => {
    const bad = { ...validCodeQuality, issues: [{ ...validCodeQuality.issues[0], category: 'typo' }] };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects a missing required field', () => {
    const { summary: _omit, ...bad } = validCodeQuality;
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects wrong types (line as string)', () => {
    const bad = { ...validCodeQuality, issues: [{ ...validCodeQuality.issues[0], line: '121' }] };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('accepts boundary scores 0 and 100', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: 0 })).not.toThrow();
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: 100 })).not.toThrow();
  });

  it('rejects scores outside 0-100', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: -1 })).toThrow(ZodError);
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: 101 })).toThrow(ZodError);
  });

  it('accepts an empty issues array (clean file)', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, issues: [] })).not.toThrow();
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => TestCoverageResultSchema.parse(validTestCoverage)).not.toThrow();
  });

  it('accepts a file with no tests (empty arrays, 0% coverage)', () => {
    const noTests = { ...validTestCoverage, hasTests: false, testFiles: [], untestedPaths: [], coverageEstimate: 0 };
    expect(() => TestCoverageResultSchema.parse(noTests)).not.toThrow();
  });

  it('rejects coverage above 100', () => {
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage, coverageEstimate: 150 })).toThrow(ZodError);
  });

  it('rejects an invalid untested path type', () => {
    const bad = { ...validTestCoverage, untestedPaths: [{ ...validTestCoverage.untestedPaths[0], type: 'module' }] };
    expect(() => TestCoverageResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects hasTests as a string', () => {
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage, hasTests: 'yes' })).toThrow(ZodError);
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts valid data', () => {
    expect(() => RefactoringSuggestionSchema.parse(validRefactoring)).not.toThrow();
  });

  it('accepts an empty suggestions array', () => {
    expect(() => RefactoringSuggestionSchema.parse({ ...validRefactoring, suggestions: [] })).not.toThrow();
  });

  it('rejects an invalid impact value', () => {
    const bad = { ...validRefactoring, suggestions: [{ ...validRefactoring.suggestions[0], impact: 'huge' }] };
    expect(() => RefactoringSuggestionSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects a suggestion missing before/after code', () => {
    const { before: _b, after: _a, ...noCode } = validRefactoring.suggestions[0]!;
    expect(() => RefactoringSuggestionSchema.parse({ ...validRefactoring, suggestions: [noCode] })).toThrow(ZodError);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a complete valid report', () => {
    expect(() => ReviewReportSchema.parse(validReport)).not.toThrow();
  });

  it('accepts a report with no file reviews and no recommendations', () => {
    const empty = { ...validReport, fileReviews: [], recommendations: [], summary: { ...validReport.summary, totalFiles: 0 } };
    expect(() => ReviewReportSchema.parse(empty)).not.toThrow();
  });

  it('rejects a PR number given as string', () => {
    const bad = { ...validReport, pullRequest: { ...validReport.pullRequest, number: '2' } };
    expect(() => ReviewReportSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects an invalid recommendation priority', () => {
    const bad = { ...validReport, recommendations: [{ ...validReport.recommendations[0], priority: 'info' }] };
    expect(() => ReviewReportSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects a report missing metadata', () => {
    const { metadata: _m, ...bad } = validReport;
    expect(() => ReviewReportSchema.parse(bad)).toThrow(ZodError);
  });

  it('safeParse returns success=false instead of throwing', () => {
    const result = ReviewReportSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('JSON Schema export (SDK structured outputs)', () => {
  it('produces an object schema with all top-level required properties', () => {
    const schema = ReviewReportJSONSchema as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
    expect(Object.keys(schema.properties)).toHaveLength(5);
  });

  it("inlines definitions (no $ref) when using $refStrategy: 'root'", () => {
    expect(JSON.stringify(ReviewReportJSONSchema)).not.toContain('"$ref"');
  });

  it('marks code-quality fields as required and keeps enum values', () => {
    const schema = CodeQualityResultJSONSchema as any;
    expect(schema.required).toEqual(expect.arrayContaining(['file', 'issues', 'overallScore', 'summary']));
    expect(schema.properties.issues.items.properties.severity.enum)
      .toEqual(['critical', 'high', 'medium', 'low', 'info']);
    expect(schema.properties.overallScore.minimum).toBe(0);
    expect(schema.properties.overallScore.maximum).toBe(100);
  });

  it('zodToJsonSchema output is valid serialisable JSON', () => {
    const json = JSON.stringify(zodToJsonSchema(ReviewReportSchema, { $refStrategy: 'root' }));
    expect(() => JSON.parse(json)).not.toThrow();
  });
});