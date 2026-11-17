import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReviewReport } from '../types/report-types.js';

/**
 * Report Generator
 * Converts ReviewReport to various output formats (Markdown, HTML, JSON)
 *
 * Extended from the provided starter: every report now includes ALL issues with
 * file/line/severity, the suggested test code, and refactoring before/after examples,
 * and HTML output escapes model-generated text so code snippets render safely.
 */

type FileReview = ReviewReport['fileReviews'][number];

const PRIORITY_EMOJI: Record<string, string> = {
  critical: '🚨',
  high: '⚠️',
  medium: '📝',
  low: '💡',
  info: 'ℹ️'
};

/** Escape text for safe inclusion in HTML (code often contains < > & quotes) */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape pipe characters/newlines so text fits inside a Markdown table cell */
const mdCell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Fenced code block that survives code containing ``` */
const mdCode = (code: string, lang = ''): string => {
  const fence = code.includes('```') ? '````' : '```';
  return `${fence}${lang}\n${code.trim()}\n${fence}`;
};

const langFor = (file: string): string => {
  const ext = path.extname(file).slice(1);
  return ({ ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', py: 'python' } as Record<string, string>)[ext] ?? ext;
};

export interface SavedReportPaths {
  json: string;
  markdown: string;
  html: string;
}

export class ReportGenerator {
  /**
   * Generate a Markdown report for PR comments
   */
  generateMarkdownReport(report: ReviewReport): string {
    const { summary, recommendations, fileReviews, pullRequest, metadata } = report;

    const formattedRecs = recommendations.map((rec, idx) =>
      `${idx + 1}. ${PRIORITY_EMOJI[rec.priority] ?? ''} **[${rec.priority.toUpperCase()}] ${rec.category}**: ${rec.description}\n` +
      `   - Files: ${rec.files.length ? rec.files.map(f => `\`${f}\``).join(', ') : 'n/a'}`
    ).join('\n\n');

    const formattedFiles = fileReviews.map(r => this.markdownFileSection(r)).join('\n\n---\n\n');

    return `# 🔍 Code Review Report: ${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | ${summary.overallScore}/100 |
| **Files Reviewed** | ${summary.totalFiles} |
| **Critical Issues** | ${summary.criticalIssues} |
| **High Priority Tests** | ${summary.highPriorityTests} |
| **Refactoring Opportunities** | ${summary.refactoringOpportunities} |

## 🎯 Recommendations

${formattedRecs || 'No recommendations at this time.'}

## 📁 File Details

${formattedFiles || '_No reviewable source files in this pull request._'}

---

*Generated at ${metadata.analyzedAt} • Duration: ${(metadata.duration / 1000).toFixed(1)}s • ` +
`Agents: ${Object.entries(metadata.agentVersions).map(([k, v]) => `${k}@${v}`).join(', ')}*
`;
  }

  private markdownFileSection(review: FileReview): string {
    const { file, codeQuality, testCoverage, refactorings } = review;
    const lang = langFor(file);

    const issues = codeQuality.issues.length
      ? '| Line | Severity | Category | Issue | Suggestion |\n|------|----------|----------|-------|------------|\n' +
        codeQuality.issues.map(i =>
          `| ${i.line} | ${PRIORITY_EMOJI[i.severity] ?? ''} \`${i.severity}\` | ${i.category} | ${mdCell(i.description)} | ${mdCell(i.suggestion)} |`
        ).join('\n')
      : '_No issues found._';

    const tests = testCoverage.untestedPaths.length
      ? testCoverage.untestedPaths.map((p, idx) =>
        `${idx + 1}. **\`${p.location}\`** (${p.type}, ${PRIORITY_EMOJI[p.priority] ?? ''} ${p.priority} priority)\n` +
        `   ${p.reasoning}\n\n${indent(mdCode(p.suggestedTest, lang), 3)}`
      ).join('\n\n')
      : '_No test gaps identified._';

    const refactors = refactorings.suggestions.length
      ? refactorings.suggestions.map((s, idx) =>
        `${idx + 1}. **${s.type}** at \`${s.location}\` (${s.impact} impact): ${s.description}\n\n` +
        `   **Before:**\n\n${indent(mdCode(s.before, lang), 3)}\n\n` +
        `   **After:**\n\n${indent(mdCode(s.after, lang), 3)}\n\n` +
        `   _Benefits:_ ${s.benefits}`
      ).join('\n\n')
      : '_No refactoring suggestions._';

    return `### 📄 \`${file}\`

**Quality Score:** ${codeQuality.overallScore}/100 | **Estimated Coverage:** ~${testCoverage.coverageEstimate}% | ` +
`**Has Tests:** ${testCoverage.hasTests ? 'yes' : 'no'}${testCoverage.testFiles.length ? ` (${testCoverage.testFiles.map(t => `\`${t}\``).join(', ')})` : ''}

#### 🛡️ Code Quality (${codeQuality.issues.length} issues)
${codeQuality.summary}

${issues}

#### 🧪 Test Coverage Gaps (${testCoverage.untestedPaths.length})
${testCoverage.summary}

${tests}

#### ♻️ Refactoring Opportunities (${refactorings.suggestions.length})
${refactorings.summary}

${refactors}`;
  }

  /**
   * Generate an HTML report for web display
   */
  generateHTMLReport(report: ReviewReport): string {
    const { summary, recommendations, metadata, pullRequest, fileReviews } = report;
    const e = escapeHtml;

    const recList = recommendations.map(r => `
      <li class="rec rec-${e(r.priority)}">
        <span class="priority">[${e(r.priority.toUpperCase())}]</span>
        <strong>${e(r.category)}</strong>: ${e(r.description)}
        <br><small>Files: ${e(r.files.join(', ') || 'n/a')}</small>
      </li>`).join('');

    const files = fileReviews.map(r => this.htmlFileSection(r)).join('\n');
    const title = `${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}`;
    const scoreClass = summary.overallScore >= 80 ? 'good' : summary.overallScore >= 50 ? 'ok' : 'bad';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Review Report - ${e(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1100px;
      margin: 0 auto; padding: 24px; background: #f8f9fa; color: #212529; line-height: 1.5; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 12px; }
    h2 { color: #2c3e50; margin-top: 36px; }
    h4 { margin: 20px 0 8px; }
    .summary { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin: 24px 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
    .metric { text-align: center; }
    .metric-value { font-size: 2em; font-weight: bold; color: #3498db; }
    .metric-value.good { color: #27ae60; } .metric-value.ok { color: #f39c12; } .metric-value.bad { color: #e74c3c; }
    .metric-label { color: #6c757d; font-size: 0.9em; }
    ul { list-style: none; padding: 0; }
    li.rec { padding: 12px; margin: 8px 0; border-radius: 4px; background: white; }
    .rec-critical { border-left: 4px solid #e74c3c; } .rec-high { border-left: 4px solid #f39c12; }
    .rec-medium { border-left: 4px solid #3498db; } .rec-low { border-left: 4px solid #27ae60; }
    .priority { font-weight: bold; margin-right: 8px; }
    .rec-critical .priority { color: #e74c3c; } .rec-high .priority { color: #f39c12; }
    .rec-medium .priority { color: #3498db; } .rec-low .priority { color: #27ae60; }
    .file { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px 24px; margin: 20px 0; }
    .file h3 { margin-top: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .scores span { display: inline-block; margin-right: 16px; color: #495057; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92em; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e9ecef; vertical-align: top; }
    th { background: #f1f3f5; }
    .sev { font-weight: bold; text-transform: uppercase; font-size: 0.8em; padding: 2px 6px; border-radius: 4px; color: white; }
    .sev-critical { background: #e74c3c; } .sev-high { background: #f39c12; } .sev-medium { background: #3498db; }
    .sev-low { background: #27ae60; } .sev-info { background: #95a5a6; }
    pre { background: #1e1e2e; color: #f8f8f2; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; }
    .item { border-top: 1px solid #e9ecef; padding: 10px 0; }
    .muted { color: #6c757d; }
    .before-after { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 760px) { .before-after { grid-template-columns: 1fr; } }
    footer { text-align: center; color: #6c757d; margin-top: 32px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>🔍 Code Review Report: ${e(title)}</h1>

  <div class="summary">
    <div class="metric"><div class="metric-value ${scoreClass}">${summary.overallScore}</div><div class="metric-label">Overall Score</div></div>
    <div class="metric"><div class="metric-value">${summary.totalFiles}</div><div class="metric-label">Files Reviewed</div></div>
    <div class="metric"><div class="metric-value">${summary.criticalIssues}</div><div class="metric-label">Critical Issues</div></div>
    <div class="metric"><div class="metric-value">${summary.highPriorityTests}</div><div class="metric-label">High Priority Tests</div></div>
    <div class="metric"><div class="metric-value">${summary.refactoringOpportunities}</div><div class="metric-label">Refactorings</div></div>
  </div>

  <h2>🎯 Recommendations</h2>
  <ul>${recList || '<li class="rec">No recommendations at this time.</li>'}</ul>

  <h2>📁 File Details</h2>
  ${files || '<p class="muted">No reviewable source files in this pull request.</p>'}

  <footer>
    Generated at ${e(metadata.analyzedAt)} • Duration: ${(metadata.duration / 1000).toFixed(1)}s •
    ${e(Object.entries(metadata.agentVersions).map(([k, v]) => `${k}@${v}`).join(', '))}
  </footer>
</body>
</html>`;
  }

  private htmlFileSection(review: FileReview): string {
    const { file, codeQuality, testCoverage, refactorings } = review;
    const e = escapeHtml;

    const issues = codeQuality.issues.length
      ? `<table><thead><tr><th>Line</th><th>Severity</th><th>Category</th><th>Issue</th><th>Suggestion</th></tr></thead><tbody>
        ${codeQuality.issues.map(i => `<tr><td>${i.line}</td><td><span class="sev sev-${e(i.severity)}">${e(i.severity)}</span></td>
          <td>${e(i.category)}</td><td>${e(i.description)}</td><td>${e(i.suggestion)}</td></tr>`).join('')}
        </tbody></table>`
      : '<p class="muted">No issues found.</p>';

    const tests = testCoverage.untestedPaths.length
      ? testCoverage.untestedPaths.map(p => `<div class="item">
          <span class="sev sev-${e(p.priority)}">${e(p.priority)}</span> <code>${e(p.location)}</code> <span class="muted">(${e(p.type)})</span>
          <p>${e(p.reasoning)}</p><pre><code>${e(p.suggestedTest)}</code></pre></div>`).join('')
      : '<p class="muted">No test gaps identified.</p>';

    const refactors = refactorings.suggestions.length
      ? refactorings.suggestions.map(s => `<div class="item">
          <strong>${e(s.type)}</strong> at <code>${e(s.location)}</code> <span class="muted">(${e(s.impact)} impact)</span>
          <p>${e(s.description)}</p>
          <div class="before-after"><div><small>Before</small><pre><code>${e(s.before)}</code></pre></div>
          <div><small>After</small><pre><code>${e(s.after)}</code></pre></div></div>
          <p class="muted">Benefits: ${e(s.benefits)}</p></div>`).join('')
      : '<p class="muted">No refactoring suggestions.</p>';

    return `<section class="file">
    <h3>📄 ${e(file)}</h3>
    <div class="scores"><span><strong>Quality:</strong> ${codeQuality.overallScore}/100</span>
      <span><strong>Est. coverage:</strong> ~${testCoverage.coverageEstimate}%</span>
      <span><strong>Tests:</strong> ${e(testCoverage.testFiles.join(', ') || 'none found')}</span></div>
    <h4>🛡️ Code Quality (${codeQuality.issues.length})</h4><p>${e(codeQuality.summary)}</p>${issues}
    <h4>🧪 Test Coverage Gaps (${testCoverage.untestedPaths.length})</h4><p>${e(testCoverage.summary)}</p>${tests}
    <h4>♻️ Refactoring Opportunities (${refactorings.suggestions.length})</h4><p>${e(refactorings.summary)}</p>${refactors}
  </section>`;
  }

  /**
   * Generate formatted JSON report
   */
  generateJSONReport(report: ReviewReport): string {
    return JSON.stringify(report, null, 2);
  }

  /** File name stem used for all three formats, e.g. udacity_cd14715-simple-todo-app_2 */
  static baseName(report: ReviewReport): string {
    const { owner, repo, number } = report.pullRequest;
    return `${owner}_${repo}_${number}`;
  }

  /**
   * Write JSON, Markdown and HTML reports to `outputDir`.
   */
  async saveAll(report: ReviewReport, outputDir: string): Promise<SavedReportPaths> {
    await mkdir(outputDir, { recursive: true });
    const base = path.join(outputDir, ReportGenerator.baseName(report));
    const paths: SavedReportPaths = {
      json: `${base}.json`,
      markdown: `${base}.md`,
      html: `${base}.html`
    };
    await Promise.all([
      writeFile(paths.json, this.generateJSONReport(report), 'utf8'),
      writeFile(paths.markdown, this.generateMarkdownReport(report), 'utf8'),
      writeFile(paths.html, this.generateHTMLReport(report), 'utf8')
    ]);
    return paths;
  }
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(line => (line ? pad + line : line)).join('\n');
}