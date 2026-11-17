import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReportGenerator, escapeHtml } from '../src/utils/report-generator.js';
import { validReport } from './fixtures.js';

describe('ReportGenerator', () => {
  const generator = new ReportGenerator();

  it('Markdown contains summary, file path, line number and refactoring code', () => {
    const md = generator.generateMarkdownReport(validReport);
    expect(md).toContain('udacity/cd14715-simple-todo-app #2');
    expect(md).toContain('| **Overall Score** | 60/100 |');
    expect(md).toContain('`src/todo.ts`');
    expect(md).toContain('| 121 |');
    expect(md).toContain('**Before:**');
    expect(md).toContain('buildSearchQuery');
    expect(md).not.toContain('undefined');
  });

  it('HTML escapes code so snippets cannot break the page', () => {
    const report = structuredClone(validReport);
    report.fileReviews[0]!.refactorings.suggestions[0]!.after = '<script>alert(1)</script>';
    const html = generator.generateHTMLReport(report);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('src/todo.ts');
  });

  it('JSON output round-trips', () => {
    expect(JSON.parse(generator.generateJSONReport(validReport))).toEqual(validReport);
  });

  it('saveAll writes all three formats with the expected file names', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reports-'));
    const saved = await generator.saveAll(validReport, dir);
    expect(path.basename(saved.json)).toBe('udacity_cd14715-simple-todo-app_2.json');
    expect(path.basename(saved.markdown)).toBe('udacity_cd14715-simple-todo-app_2.md');
    expect(path.basename(saved.html)).toBe('udacity_cd14715-simple-todo-app_2.html');
    expect(JSON.parse(await readFile(saved.json, 'utf8')).pullRequest.number).toBe(2);
  });

  it('escapeHtml escapes all special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});