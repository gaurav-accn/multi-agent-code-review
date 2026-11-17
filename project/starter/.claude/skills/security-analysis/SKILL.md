---
name: security-analysis
description: Security-focused code review based on OWASP Top 10 - injection, secrets, sensitive payment data, auth and input validation checks for any language
---

# Security Analysis

Apply to EVERY reviewed file regardless of language.

## Injection (OWASP A03) - usually CRITICAL
- SQL built with template literals or `+` concatenation containing any parameter:
  `` `... WHERE id = '${id}'` ``, `"... = " + value`, `LIKE '%${kw}%'`
  → Fix: parameterized queries (`db.query(sql, [param])`) or a query builder. Manual escaping is not acceptable.
- Shell commands built from user input → command injection
- `eval`, `new Function`, `innerHTML` with untrusted data → code injection / XSS

## Sensitive Data Exposure
- Raw card numbers or CVV stored, logged or passed around → CRITICAL (PCI-DSS forbids storing CVV)
  → Fix: tokenize via the payment provider; never persist CVV
- Hardcoded secrets (API keys, passwords, tokens, connection strings) → CRITICAL
- Secrets or personal data in logs or error messages → HIGH

## Input Validation
- Missing type/length/format/range validation on external input → HIGH/MEDIUM
- Weak validation (length-only card check without Luhn) → MEDIUM
- Trusting client-supplied amounts, prices or roles for money/authorization decisions → HIGH

## Access Control
- Acting on a resource by ID without checking the caller owns it (IDOR) → HIGH
- Privilege changes (subscription upgrades, role changes) without verifying payment/authorization → HIGH
- `Math.random()` for IDs or tokens → MEDIUM (use `crypto.randomUUID()`)

## Error Handling
- Leaking stack traces or DB errors to callers → MEDIUM
- Partial failure without rollback (charged but not upgraded, or upgraded but not charged) → HIGH

## Severity Guidance
- critical: directly exploitable (injection, stored CVV, leaked secret)
- high: exploitable with conditions, or broken money/auth integrity
- medium: defense-in-depth gap
- low/info: hardening suggestions

## Output
For each finding: line, severity, category `security`, what an attacker could do (one sentence), and the secure replacement code.