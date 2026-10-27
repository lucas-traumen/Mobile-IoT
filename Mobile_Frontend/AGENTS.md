# AGENTS.md

## Stack

- The app lives in `app-mobile/`: Expo SDK ~57 (React Native 0.86.3, React 19.2.3, TypeScript 6.0.3 strict). App name `IoT Dashboard`, Android package `com.example.iot`.
- Runtime deps: `mqtt@^5` (MQTT over WebSocket), `zustand`, `zod`, `@react-native-async-storage/async-storage`, `react-native-svg` + `victory-native@36` (charts).
- Lint / format / test: ESLint 8 (`eslint-config-expo` + `eslint-plugin-boundaries`), Prettier 2.8.8, Jest 29 (`jest-expo`).
- Node `>= 22.11.0`.

## Setup (first clone)

- `npm install` inside `app-mobile/` — required before any other command; `node_modules/` is gitignored.
- No native dirs committed: `npx expo prebuild` generates `android/`/`ios/` when a native build is needed.

## Commands (run inside `app-mobile/`)

- `npm start` — Expo dev server (Metro).
- `npm test` — Jest (jest-expo). Single file: `npm test -- payloads` (`--testPathPattern` also works).
- `npm run lint` — ESLint incl. module-boundary rules.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run format:check` — Prettier check.

## Layout

- `app-mobile/src/core/` — eventbus, di, errors (Result), time, logger, constants/topics.
- `app-mobile/src/modules/{settings,telemetry,relay,history}/` — each module: `api/` (public facade, TSDoc), `internal/` (domain/data/services, private), `ui/`, `README.md`.
- `app-mobile/src/app/` — composition root (`wiring/container.ts`) + tab shell + lifecycle.
- `app-mobile/App.tsx` — bootstrap + 3-tab shell (Dashboard / History / Settings).
- Tests are colocated `*.test.ts` inside modules' `internal/`.
- `app-mobile/README.md` — setup, architecture, MQTT topic contract, mosquitto WebSocket listener config, InfluxDB v2 notes.

## Conventions

- Prettier: `singleQuote: true`, `trailingComma: 'all'`, `arrowParens: 'avoid'`.
- TS `strict: true`; no `any`; no `console.*` outside `src/core/logger/`.
- Module boundary: a module imports `core` and other modules' `api/` only — enforced by `eslint-plugin-boundaries` (error level).
- Cross-module communication via typed EventBus + `api/` facades; wiring only in the composition root (manual DI).
- Zod validates all external data (MQTT payloads, InfluxDB responses, settings form).
- Import aliases: `@core/*`, `@modules/*`, `@app/*`.
- No `.env` / secrets in repo; broker + InfluxDB credentials live in on-device AsyncStorage only.
- Durable decisions and architecture notes: `.ai/memory/` (PROJECT, DECISIONS, CONVENTIONS, KNOWN_ISSUES).

## Out of scope (do not invent)

- No CI, PR template, branch policy, or release flow is documented. Don't add any without asking.
- No `.env` or secrets wiring exists; ask before introducing one.

## OpenCode Harness V2 workflow

The durable specification is `OPENCODE_HARNESS_V2_ARCHITECTURE.md` (repo root).

Four role-based agents:

- `orchestrator` (primary): discussion, task planning, capability routing, approval, delegation, recovery, synthesis, memory promotion. No separate planner/researcher.
- `coder` (subagent): implementation owner.
- `tester` (subagent): independent verification.
- `reviewer` (subagent): independent read-only two-axis review (Standards + Spec).

Required flow:

`discuss → classify + capability contract → plan → user approve → implement → verify → review → user accept → memory promotion`

### Key V2 mechanisms

- Orchestrator routes ROLE + CAPABILITIES; each worker invokes its REQUIRED skills in its own context (capability contract, never preloaded skill dumps).
- Capability levels and per-skill routing live in `.ai/capabilities/SKILL_POLICY.md` (REQUIRED / RECOMMENDED / OPTIONAL / DENY).
- Strategic direction: `.ai/roadmap/PROJECT_ROADMAP.md`; tactical task contract: `.ai/plans/current-plan.md`; recoverable checkpoint: `.ai/state/current-task.md`.
- GitNexus freshness: re-analyze only when the index is missing/stale or changes are large — not before every task.

### Subtask retry and session continuity

- The `task_id` returned by a subtask is the child session identifier. The orchestrator must retain it immediately in the handoff/checkpoint together with the role, attempt number, status, failure class, last checkpoint, and next action. Do not store hidden reasoning or secrets.
- When a subtask fails after returning a valid `task_id`, retry with that same `task_id`; never create a fresh subtask by omitting the ID. The retry prompt must explicitly say to continue from the previous session and inspect existing results before doing work again.
- Reusing `task_id` preserves the child session history, but does not resume an interrupted tool call. The worker must still inspect durable state, `git status`, `git diff`, and changed files before continuing, and must avoid repeating completed side effects.
- Before retrying, verify that the recorded `task_id` still resolves. If it cannot be resolved, record the reason (`session_not_found`, `id_not_returned`, or equivalent) and only then launch a fresh subtask with a complete durable handoff.
- If the task invocation fails before returning a `task_id`, no child session can be resumed; record that fact and launch a fresh attempt only with an explicit fresh-retry reason.
- For background work, record both the child `task_id` and any distinct background `job_id`. A job status or notification is not a substitute for the child session history.

### Guardrails

- Orchestrator không sửa production code.
- Coder chỉ làm trong approved scope.
- Tester không repair production code.
- Reviewer không repair production code.
- Subagents không delegate subagent khác.
- Không push tự động.
- Không commit tự động trừ khi user yêu cầu.
- Tối đa 2 coder-fix cycles tự động; sau đó dừng và báo blocker.
- Durable decisions phải nằm trong `.ai/memory/`, không chỉ ở session history.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Mobile-AI-IoT** (3457 symbols, 9201 relationships, 208 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Mobile-AI-IoT/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Mobile-AI-IoT/clusters` | All functional areas |
| `gitnexus://repo/Mobile-AI-IoT/processes` | All execution flows |
| `gitnexus://repo/Mobile-AI-IoT/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
