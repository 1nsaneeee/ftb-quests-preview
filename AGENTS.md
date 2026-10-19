# Agent instructions

This repository is a local FTB Quests preview/editor with a headless CLI.

- For any FTB Quests data work, load `skills/ftbquests/SKILL.md` and use the `ftbquest` CLI. If the skill is not loaded, run `ftbquest skill`. Do not hand-edit `chapters/*.snbt` or `lang/*.snbt` when a CLI command covers the change.
- If `ftbquest` is not on PATH, install with `npm install -g ftb-quests-preview`, or run `npm link` in this source directory. Do not fall back to `node cli.mjs` unless linking/installation is impossible.
- `ftbquest` with no command starts the browser preview; first run configures the data source in the web page. The CLI commands below are for AI/scripting.
- Read before writing: `ftbquest list --json --brief`, `ftbquest show <id> --json`, `ftbquest lint --json`, `ftbquest schema patch --json`.
- Patch is dry-run by default. Run `ftbquest patch --file <patch> --json` first, inspect the hunks, then add `--apply`. Never skip the dry run for multi-quest or multi-file patches.
- Writes create backups under the quest data directory's `.quest-preview-backups/`. Do not delete backups.
- On `conflict`, reload and regenerate the patch; do not retry the same revision.
- Browser UI: `ftbquest` (or `ftbquest-preview`) on `http://127.0.0.1:4173`; first run opens `/setup.html`. The CLI is the AI path.
- Before finishing code changes, run `npm run check` and `npm test`.
- Do not publish to npm, change global config, or run destructive git operations without an explicit human request.
