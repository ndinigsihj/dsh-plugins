# Fixture global instructions (regression gate)

This file is the **user-global `AGENTS.md` fixture** for `scripts/regression-gate.sh`.
The gate copies it to the temporary `DSH_HOME` so the zero-LLM smoke run shows the
second-round `agent-instructions` injection without reading the real `~/.dsh`.

Content is intentionally inert: it exists so `@deepseek-ai/dsh-agent-instructions`
has a deterministic user-global source, not to instruct anyone.
