---
name: ask-matt-flow
description: Run the idea→ship pipeline as a fixed sequence (setup → clarify → shape → spec → tickets → implement → review → debug/repair → handoff), loading each stage skill and enforcing human gates. Use when the user wants a guided, fixed development flow; for routing questions use ask-matt instead.
disable-model-invocation: true
---

# Ask Matt Flow

You are a **thin orchestrator**. You do not rewrite any stage methodology — load the right skill for each stage and follow it. The flow is optional: if the situation does not fit the fixed pipeline (bug triage, huge foggy direction, unknown next step), escape to the right skill or to `ask-matt` instead.

## State file (resume/checkpoint)

The flow tracks progress in `.dsh/ask-matt-flow/state.md`. At the start:

1. If the state file exists, read it and resume at its `next-stage` (do not restart from scratch).
2. If it does not exist, create it with `current-stage: setup`, `next-stage: clarify`.

Update the state file **only after a gate is confirmed by the user**. The file has these fields:

```markdown
# ask-matt-flow state
- current-stage: <stage>
- next-stage: <stage>
- artifacts: <paths or "none">
- decisions: <short bullets>
- updated: <date>
```

Long sessions will hit the ~150k smart zone. At a phase boundary, `/compact` (or a fresh session) is fine **after the state file is updated** so the next session can resume.

## Pipeline

| # | Stage | Load these skills | Human gate before advancing |
|---|---|---|---|
| 0 | Setup | `setup-matt-pocock-skills` | User confirms tracker / triage labels / doc layout |
| 1 | Clarify | `grill-with-docs` (no repo: `grill-me`) + `domain-modeling` | User confirms shared understanding |
| 2 | Shape (optional) | `prototype` for a runnable shape question; `wayfinder` for huge foggy direction | User picks the direction / answers |
| 3 | Spec | `to-spec` (alias: `to-prd` if upstream renames) | User approves the spec |
| 4 | Tickets | `to-tickets` (alias: `to-issues`) | User confirms granularity and dependencies |
| 5 | Implement | `implement` + `tdd`; one ticket per fresh session/window | Each ticket done, tests green |
| 6 | Review | `code-review` in a **fresh subagent** (new context) | User reviews findings |
| 7 | Debug/Repair | `diagnosing-bugs` if something is broken; `codebase-design` / `improve-codebase-architecture` if seams are the problem | User decides the fix/architecture direction |
| 8 | Handoff | `handoff` at session boundary | User accepts the handoff doc |

## How to load stage skills

- Use this session's skill loading tool. In standard profiles it is `skill`; in minimal-plus it is `skill_search` + `skill_load`. Phrase it as: *load the `X` skill and follow it* — do not write `/X` as if it were a user command.

## Escape hatches

- Unknown next step → run `ask-matt` to route.
- Incoming bugs/requests → `triage` (do not triage tickets this flow produced).
- Bug that resists a first glance → `diagnosing-bugs` (feedback loop first).
- Greenfield / huge feature → `wayfinder`, then merge back at the Spec stage.
- A design question that needs runnable code → `prototype`, bridged by `handoff` in both directions.

## Rules

1. **One question/one window discipline**: follow each loaded skill's own rules (e.g. `grilling` asks the whole current frontier in one round — numbered questions plus recommended answers — then waits; `tdd` does one red-green slice at a time).
2. **Gates are real**: do not mark a stage done until the user confirms the gate listed above.
3. **No parallel sources of truth**: the state file is the only flow progress record; specs/tickets/ADRs live where their skills put them (repo convention is upstream: `CONTEXT.md`, `docs/adr/`, `.scratch/`, tracker).
4. **Fresh context for review**: run `code-review` in a subagent with its own context, never in the same context as the implementation.
5. **Session boundaries**: before ending the session, update the state file and, if handing off to another machine/directory/agent, run `handoff`.