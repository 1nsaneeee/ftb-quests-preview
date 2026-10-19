# Quest editor and install loop — design record

Status: implemented. Automated Node tests pass, and the editor loop was manually exercised in a browser against synthetic fixtures and a copy of a real 1.21.1 / FTB Quests 2101.1.26 data directory. No automated browser test suite is included. This records the agreed boundary and API contract; see `README.md` for the user-facing install and usage workflow.

## Product and permission boundary

- This is a local authoring tool for the user's selected FTB Quests data, not a remote service. The HTTP server must bind only to `127.0.0.1`.
- The user explicitly chooses an instance root or a separate quests data directory during setup. A bundled demo is selected only by `--demo` / local demo mode, or when there is no configured source and the working directory has no quest data.
- Saving edits only the selected quest's supported presentation fields. It does not edit tasks, rewards, conditions, dependencies, chapter metadata, or game/resource assets.
- Every save creates a recoverable backup of the original file bytes. The manifest records `originalExists` to distinguish a prior file from a newly created locale file. Writes are limited to resolved, configured quest-data roots; client input never supplies a filesystem path.
- The published repository contains source, documentation, tests, and synthetic fixtures only. Local config, demo working copy, backups, screenshots, instance data, and Minecraft/FTB assets remain excluded. The project uses the user-selected MIT license; third-party game/mod assets are not bundled.

## Install and path contract

- Requirements: Node.js 20+ and its bundled npm; recommend maintained Node.js 24 LTS. No dependency install, runtime download, administrator permission, PATH change, or execution-policy change is required.
- `npm run setup` offers instance, separate quests folder, or demo setup; command-line equivalents are `--instance-root PATH`, `--data-dir PATH`, and `--demo`. A separate data directory must contain `chapters/`; `lang/` is optional.
- CLI/environment paths resolve from the current working directory. Paths in `quest-preview.local.json` resolve from that file's directory. Setup stores relative paths where possible; a cross-drive Windows path requires explicit confirmation or `--absolute-paths` and remains in the ignored local config.
- Existing local config is never overwritten implicitly. `--replace` first creates a timestamped backup. `npm start` launches the preview; `npm run setup -- --help` describes setup flags.
- Resolution precedence is CLI, environment (`QUEST_PREVIEW_INSTANCE_ROOT`, `QUEST_PREVIEW_DATA_DIR`), local config, then demo. An explicitly configured but missing/invalid path is an error, not a silent demo fallback.

## Editing interaction and save contract

- The graph exposes selection and node dragging; coordinate fields mirror `x`/`y`. The inspector edits title, subtitle, and description text. Description input remains plain text lines; rendering continues to interpret the already-supported formatting/page-break syntax.
- Editable scope is limited to `x`, `y`, `title`, `subtitle`, and `description`. Text is written to the selected locale override; chapter graph coordinates are written to their owning chapter SNBT. Existing comments, unknown keys, formatting, ordering, line endings, and BOM are preserved by source-span edits rather than whole-file reserialization.
- `GET /api/data?locale=LOCALE` retains the current response and adds `editing: { enabled, token, revisions }`. Revisions are SHA-256 hashes keyed by relative `chapters/<filename>` and `lang/<locale>.snbt`; a missing locale file has a `null` revision.
- `POST /api/save` accepts `{ locale, revisions, changes: [{ questId, x?, y?, title?, subtitle?, description?: string[] }] }`. The server validates configured IDs, supported locale basenames, field types/limits, same-origin `Origin`, loopback `Host`, JSON content type, and `X-Quest-Preview-Token` before writing.
- Success returns `{ saved: true, backups: [relative paths], data: <fresh GET payload> }`. Stale hashes return HTTP 409 `{ error: "conflict" }`; validation and write failures use bounded 4xx/5xx responses without absolute paths.
- For each batch the server verifies all revisions before mutation, stores original bytes and an `originalExists` manifest under `.quest-preview-backups/<UTC timestamp>-<random>/`, writes staged files beside each target, then atomically renames. If a later replacement fails, already-replaced targets are restored from their backups. The file watcher refreshes the UI after successful writes.
- Conflict resolution is explicit: reload current source, compare/reapply the intended change, then save again. The client must not silently overwrite or auto-merge stale revisions.

## Fidelity and recovery boundary

- This remains an offline approximation. It does not edit conditions/tasks/rewards or reproduce Minecraft's 3D item widgets and renderer pixel-for-pixel.
- Reopen/reload verification means the app re-reads the persisted SNBT. In-game visibility is a separate boundary: FTB Quests may need its normal reload/reopen behavior, and this tool does not send commands to the running game.
- Backups are user data and are never auto-pruned. Recovery is manual: stop editing; for `originalExists: true`, copy the backed-up original to its recorded relative path; for `originalExists: false`, remove the file created by that save. Then reload the preview. The UI must show the backup location without exposing absolute paths.

## Acceptance checks

- Setup works from a clone or ZIP at an arbitrary project path, supports a real instance/data directory and the synthetic demo, and never overwrites existing config without `--replace`.
- Relative config paths resolve from the config file; CLI/environment paths resolve from the documented working directory. Missing explicit input fails clearly instead of falling back.
- Browser tests cover node drag/coordinate synchronization, title/subtitle/description edits, save and reload, backup creation/recovery evidence, and conflict handling.
- Backend tests prove only supported fields change; comments/unknown fields/BOM/EOL survive; invalid IDs, paths, locale names, origin/token, stale revision, and oversized payload are rejected; multi-file failure restores prior originals.
- The project check includes all new Node modules; the Windows setup entry syntax is tested if one is added. No real task-save test runs against the user's live instance without explicit approval.
