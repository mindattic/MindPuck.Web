# MindAttic project agent entrypoint

Read the shared protocol at ..\mindattic-agent-standard\AGENTS.md and this project's own
documentation. Common prompt commands are implemented by the shared runner; do not add a second
copy under a provider-specific command folder.

Project context: `docs/DESIGN.md` (rules, physics numbers, level generation and the solver).
Build with `npm run build`. `npm run levels` prints what the solver made of a run of levels. Tests are `npm test` (vitest), run only when the user asks.
