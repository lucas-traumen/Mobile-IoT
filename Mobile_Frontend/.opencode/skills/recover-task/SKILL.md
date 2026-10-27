---
name: Recover Task
description: Reconstruct enough durable task context to continue safely after a model, provider, network, session, or subagent failure.
---

# Recover Task

Use after model/provider/network/session/subagent failure or when a fresh session takes over.

## Recovery sources

Read in order:

1. `AGENTS.md`
2. `.ai/plans/current-plan.md`
3. `.ai/state/current-task.md`
4. relevant `.ai/memory/*`
5. `git status`
6. `git diff`
7. changed files
8. GitNexus when available

## Procedure

Reconstruct:

- goal;
- approved scope;
- completed work;
- in-progress work;
- remaining work;
- changed files;
- verification state;
- review state;
- blockers;
- affected flows.

Do not assume access to failed agent's hidden working memory.

Treat durable artifacts + repository state as source of truth.
