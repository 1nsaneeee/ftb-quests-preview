# Agent instructions

This repository is a local FTB Quests preview/editor with a headless CLI.

- For any FTB Quests data work, load `skills/ftbquests/SKILL.md` and use the `ftbquest` CLI. If the skill is not loaded, run `ftbquest skill`. Do not hand-edit `chapters/*.snbt` or `lang/*.snbt` when a CLI command covers the change.
- If `ftbquest` is not on PATH, run `npm link` once in this directory. Do not fall back to `node cli.mjs` unless linking is impossible.
- Read before writing: `ftbquest list --json --brief`, `ftbquest show <id> --json`, `ftbquest lint --json`, `ftbquest schema patch --json`.
- Patch is dry-run by default. Run `ftbquest patch --file <patch> --json` first, inspect the hunks, then add `--apply`. Never skip the dry run for multi-quest or multi-file patches.
- Writes create backups under the quest data directory's `.quest-preview-backups/`. Do not delete backups.
- On `conflict`, reload and regenerate the patch; do not retry the same revision.
- Browser UI: `ftbquest-preview` (or `npm start`) on `http://127.0.0.1:4173`. The CLI is the AI path.
- Before finishing code changes, run `npm run check` and `npm test`.
- Do not publish to npm, change global config, or run destructive git operations without an explicit human request.
