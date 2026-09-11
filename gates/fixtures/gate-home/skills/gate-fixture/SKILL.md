---
name: gate-fixture
description: Deterministic skill fixture for the regression gate; registers nothing and has no side effects.
---

# Gate fixture skill

Inert fixture. `@deepseek-ai/dsh-skill-filesystem` scans `$DSH_HOME/skills`; the gate
copies this directory into the temporary home so the second-round `skill-catalog`
injection is observable with an isolated `DSH_HOME`.

No instructions, no tools, no side effects.
