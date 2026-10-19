# AI-first headless CLI — design record

Status: implemented (2026-10-19). See `README.md` for usage and `cli.mjs` / `server/store.mjs` for the implementation.

## Problem

The browser preview is optimized for a human looking at a page. An AI agent needs a stable, structured surface:

- raw quest data and source locations, not only localized display text;
- one command per intent instead of many UI actions;
- schema and allowed values so fields/types are not guessed;
- dry-run, diff, lint, conflict diagnosis, backups, and idempotent writes;
- JSON output and exit codes suitable for scripting and CI.

## Command surface (P0)

- `list` — chapters, chapter groups, quest summaries. `--brief` for context-efficient output.
- `show <questId>` — localized fields, dependencies, tasks, rewards, source file/line. `--raw` adds the raw SNBT compound.
- `search <query>` — search ID/title/subtitle/description/tasks/rewards.
- `lint` — offline consistency checks; `--strict` exits 1 on errors.
- `schema [section]` — field/enum model derived from FTB Quests 2101.1.26, including the current patch limits.
- `patch --file <path>` — default dry-run; `--apply` writes.

Source resolution is shared with the browser server (`--data-dir`, `--instance-root`, `--demo`, local config). Demo mode edits the same ignored `.local/demo-quests` copy.

## Patch contract (P0)

```json
{
  "locale": "zh_cn",
  "edits": [{ "questId": "ABC", "x": 1.5, "y": -1, "title": "...", "description": ["..."] }]
}
```

- Writable fields: `x`, `y`, `title`, `subtitle`, `description`. Everything else is readable/lintable but not writable yet.
- Reuses `validateChanges` and `saveQuestChanges`: same limits, revision checks, backup manifest, staged replacement, and rollback.
- `dryRun` runs the same source-span patching and diffing, then returns before backups/staging.
- No-op targets are filtered by byte comparison. Repeating an already-applied patch returns `unchanged: true` and creates no backup.
- Locale from the patch selects the store locale, so `"locale": "zh_cn"` works without `--locale`.
- On revision conflict the CLI returns an error instead of overwriting; the caller must reload and reapply.

## Lint rules (P0)

Duplicate quest/task/reward/chapter IDs; missing/self/cyclic dependencies; duplicate or invalid coordinates; unknown shapes; unknown task/reward types; missing task/reward `id`/`type`; chapter filename mismatch; missing chapter group; impossible `min_required_dependencies`; duplicate dependencies; missing titles in every locale; empty chapters; invalid linked quests.

## Non-goals for P0

- Editing tasks, rewards, flags, chapter images, quest links, or chapter settings. Schema covers them for reading, but patch stays conservative until nested span editing and per-type validation exist.
- MCP wrapper. The CLI is the first consumer; an MCP server can wrap the same store/patch functions later.
- Reading player progress from `saves/<world>/ftbquests/`. This is a separate feature direction.
- Browser UI changes. The browser keeps its existing API and behavior.
