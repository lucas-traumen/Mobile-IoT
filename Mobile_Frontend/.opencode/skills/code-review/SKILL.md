---
name: Code Review
description: Perform independent read-only review of a completed diff using the approved plan, test evidence, and code-impact context.
---

# Code Review

## Inputs

- approved plan
- acceptance criteria
- Git diff
- tester result
- relevant project memory
- repository
- GitNexus when available

## Procedure

1. Review changed code, not coder intention.
2. Map changed symbols/modules.
3. Use GitNexus when the handoff requires it (non-trivial diffs): callers, callees, dependencies, execution flows, blast radius.
4. Perform both axes in this session — do not spawn nested review subagents:

   **Axis A — Standards**

   - repository coding conventions
   - architecture consistency
   - maintainability
   - code smells
   - error handling
   - security where relevant
   - unnecessary coupling
   - blast radius

   **Axis B — Spec**

   - required behavior vs acceptance criteria
   - missing behavior
   - incorrect behavior
   - unrequested scope (scope creep)
   - missing tests for affected behavior

5. Check edge cases and regression risk.
6. Do not modify code.
7. Rank findings by severity.

Output:

- verdict
- capabilities_used
- blockers
- major
- minor
- standards_findings
- spec_findings
- impact
- missing tests
- recommendation
